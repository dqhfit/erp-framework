/// <reference path="./tokenshrink.d.ts" />
/* ==========================================================
   llm-client.ts — Gọi LLM phía server cho node "agent".
   Đọc bảng llm_profiles; hỗ trợ Anthropic API và các endpoint
   OpenAI-compatible (openai, ollama).

   Khoá API: lưu encrypted ở llm_profiles.api_key_enc (prefix
   "enc:v1:"), decrypt qua crypto.ts (AES-256-GCM, key từ
   ENCRYPTION_KEY env). Fallback env var ANTHROPIC_API_KEY /
   OPENAI_API_KEY CHỈ kích hoạt khi opt-in bằng env
   ERP_ALLOW_ENV_LLM_KEY=1 — mặc định tắt để tránh leak tenant
   isolation (company A vô tình dùng key của ENV chung).
   Ollama không cần key (local) nên fallback luôn cho phép.
   ========================================================== */
import { and, eq, isNull } from "drizzle-orm";
import { llmProfiles } from "@erp-framework/db";
import type { DB } from "./db";
import type { RunWorkflowOptions } from "@erp-framework/core";
import { decryptSecret } from "./crypto";
import { formatGuardrailPreamble, loadActiveGuardrails } from "./workflow-guardrails";
import { compress } from "tokenshrink";

type AgentResult = {
  text: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
};

interface ProfileRow {
  adapter: string;
  model: string;
  endpoint: string | null;
  apiKeyEnc: string | null;
  temperature: number | null;
  maxTokens: number | null;
}

interface AnthropicResp {
  model?: string;
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}
interface OpenAiResp {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

async function callAnthropic(
  p: ProfileRow,
  key: string,
  system: string,
  prompt: string,
): Promise<AgentResult> {
  // claude-cli → bridge cục bộ (BRIDGE_URL/bridge:8909), không cần key.
  const safeUrl = (v: string | null, fb: string) =>
    v && (v.startsWith("http://") || v.startsWith("https://")) ? v : fb;
  const base = (
    p.adapter === "claude-cli"
      ? process.env.BRIDGE_URL || safeUrl(p.endpoint, "http://localhost:8909")
      : p.endpoint || "https://api.anthropic.com"
  ).replace(/\/$/, "");
  const res = await fetch(base + "/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { "x-api-key": key } : {}),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: p.model,
      max_tokens: p.maxTokens ?? 4096,
      temperature: p.temperature ?? 0.7,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`LLM (Anthropic) lỗi ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as AnthropicResp;
  return {
    text: (j.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join(""),
    model: j.model ?? p.model,
    usage: {
      input_tokens: j.usage?.input_tokens ?? 0,
      output_tokens: j.usage?.output_tokens ?? 0,
    },
  };
}

async function callOpenAiCompat(
  p: ProfileRow,
  key: string,
  system: string,
  prompt: string,
): Promise<AgentResult> {
  const base = (p.endpoint || "https://api.openai.com").replace(/\/$/, "");
  const res = await fetch(base + "/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({
      model: p.model,
      temperature: p.temperature ?? 0.7,
      max_tokens: p.maxTokens ?? 4096,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM (OpenAI-compat) lỗi ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as OpenAiResp;
  return {
    text: j.choices?.[0]?.message?.content ?? "",
    model: j.model ?? p.model,
    usage: {
      input_tokens: j.usage?.prompt_tokens ?? 0,
      output_tokens: j.usage?.completion_tokens ?? 0,
    },
  };
}

/** Tạo hàm callAgent cho workflow runner — đọc LLM profile từ DB.
 *  ctx (tuỳ chọn): khi có companyId + workflowId, nạp guardrails (bài học từ
 *  lỗi lặp) MỘT LẦN/run (memo trong closure) rồi chèn vào đầu system prompt
 *  để agent tránh lặp lại lỗi cũ. Toàn-workflow (mọi node agent nhận chung). */
export function makeCallAgent(
  db: DB,
  ctx?: { companyId: string; workflowId: string },
): NonNullable<RunWorkflowOptions["callAgent"]> {
  // Memo guardrail preamble theo run (mỗi executeWorkflow tạo 1 callAgent).
  let preamblePromise: Promise<string> | null = null;
  const getPreamble = (): Promise<string> => {
    if (!ctx) return Promise.resolve("");
    if (!preamblePromise) {
      preamblePromise = loadActiveGuardrails(db, ctx.companyId, ctx.workflowId)
        .then(formatGuardrailPreamble)
        // Fail-safe: lỗi nạp guardrail không được chặn node agent.
        .catch(() => "");
    }
    return preamblePromise;
  };
  return async (cfg, vars) => {
    const wanted = typeof cfg.profile === "string" ? cfg.profile : undefined;
    // Workflow agent node chạy server-side (thường theo lịch, không user) →
    // chỉ dùng profile CÔNG TY (user_id NULL), không vớ profile cá nhân.
    const rows = await db
      .select()
      .from(llmProfiles)
      .where(and(isNull(llmProfiles.userId), wanted ? eq(llmProfiles.name, wanted) : undefined))
      .limit(1);
    const p = rows[0];
    if (!p) throw new Error("Chưa có LLM profile — không chạy được node agent");

    const baseSystem =
      typeof cfg.system === "string"
        ? cfg.system
        : "Bạn là một agent trong workflow ERP. Trả lời ngắn gọn.";
    // Chèn guardrails (nếu có) lên đầu để agent đọc bài học trước khi làm.
    const preamble = await getPreamble();
    const system = preamble ? `${preamble}\n${baseSystem}` : baseSystem;
    const rawPrompt =
      typeof cfg.prompt === "string"
        ? cfg.prompt
        : `Dữ liệu workflow hiện tại:\n${JSON.stringify(vars, null, 2)}`;
    const { compressed: prompt } = compress(rawPrompt);

    const profileKey = p.apiKeyEnc ? decryptSecret(p.apiKeyEnc) : "";
    const allowEnvFallback = process.env.ERP_ALLOW_ENV_LLM_KEY === "1";
    /* Khi profile thiếu key, chỉ Ollama (local) là tự do fallback.
       Provider thương mại — yêu cầu opt-in env để tránh leak key chung
       sang tenant chưa setup. Throw lỗi rõ ràng nếu thiếu key. */
    const resolveKey = (adapter: string, envVar: string): string => {
      if (profileKey) return profileKey;
      if (adapter === "ollama" || adapter === "claude-cli") return ""; // local/bridge, không cần key
      if (allowEnvFallback) return process.env[envVar] || "";
      throw new Error(
        `LLM profile "${p.adapter}" thiếu API key. Vào Cài đặt → LLM ` +
          "để khai báo, hoặc set ERP_ALLOW_ENV_LLM_KEY=1 để cho phép " +
          `dùng env var ${envVar} (không khuyến nghị production).`,
      );
    };
    if (p.adapter === "claude" || p.adapter === "claude-pro" || p.adapter === "claude-cli") {
      return callAnthropic(p, resolveKey(p.adapter, "ANTHROPIC_API_KEY"), system, prompt);
    }
    if (p.adapter === "openai" || p.adapter === "ollama") {
      return callOpenAiCompat(p, resolveKey(p.adapter, "OPENAI_API_KEY"), system, prompt);
    }
    throw new Error(`Adapter "${p.adapter}" chưa hỗ trợ ở server runtime`);
  };
}
