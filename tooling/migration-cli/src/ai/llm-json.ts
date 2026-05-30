/* ==========================================================
   llm-json.ts — Gọi LLM 1 shot, kỳ vọng response JSON.

   Port từ packages/server/src/llm-json.ts vì migration-cli
   không thể import @erp-framework/server (circular dep). Logic
   y hệt — chọn llm_profile kind=chat đầu tiên của company,
   Anthropic + OpenAI/Ollama adapter, fail-safe trả null.
   ========================================================== */

import { and, eq, isNull } from "drizzle-orm";
import { llmProfiles } from "@erp-framework/db";
import type { DB } from "./db.js";
import { decryptSecret } from "./crypto.js";

export interface CallLlmJsonOpts {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  profileName?: string;
  /** Override timeout (ms). Mặc định 540s cho claude-cli (CLI subprocess
   *  chậm), 45s cho adapter API trực tiếp. */
  timeoutMs?: number;
}

export interface CallLlmJsonResult<T> {
  output: T | null;
  usageIn: number; // input token thực từ API (0 nếu API không trả).
  usageOut: number;
  /** Khi output=null, error giải thích lý do (no_profile/no_api_key/
   *  http_<status>/parse_fail/timeout/fetch_<msg>). */
  error?: string;
  /** Raw response từ API khi parse fail — giúp debug prompt. */
  raw?: string;
}

export async function callLlmJson<T = unknown>(
  db: DB,
  companyId: string,
  opts: CallLlmJsonOpts,
): Promise<T | null> {
  const r = await callLlmJsonWithUsage<T>(db, companyId, opts);
  return r.output;
}

export async function callLlmJsonWithUsage<T = unknown>(
  db: DB,
  companyId: string,
  opts: CallLlmJsonOpts,
): Promise<CallLlmJsonResult<T>> {
  let p: typeof llmProfiles.$inferSelect | undefined;
  try {
    // Codegen migration dùng profile CÔNG TY (server-side) → bỏ profile cá nhân.
    const conds = [
      eq(llmProfiles.companyId, companyId),
      eq(llmProfiles.kind, "chat"),
      isNull(llmProfiles.userId),
    ];
    if (opts.profileName) conds.push(eq(llmProfiles.name, opts.profileName));
    [p] = await db
      .select()
      .from(llmProfiles)
      .where(and(...conds))
      .limit(1);
  } catch (e) {
    // Lỗi truy vấn (vd pool bị đóng khi server hot-reload/restart giữa lúc
    // query, hoặc DB tạm mất kết nối). Trả structured error thay vì throw —
    // để batch "Run All Procs" không vỡ cả lượt, proc khác vẫn chạy tiếp.
    return {
      output: null,
      usageIn: 0,
      usageOut: 0,
      error: `db_error: truy vấn llm_profiles thất bại (${(e as Error).message.slice(0, 200)}). Thường do server restart/hot-reload giữa lúc query — thử lại.`,
    };
  }
  if (!p) {
    return {
      output: null,
      usageIn: 0,
      usageOut: 0,
      error: `no_profile: company ${companyId.slice(0, 8)}... chưa có llm_profile kind=chat${opts.profileName ? ` tên "${opts.profileName}"` : ""}. Vào Settings → LLM để thêm`,
    };
  }

  const user = opts.user.slice(0, 8000);
  const maxTokens = opts.maxTokens ?? 1024;
  const temperature = opts.temperature ?? 0.2;
  // Bridge (claude-cli) chạy CLI subprocess — ~2k token đã ~38s, tier D 4k
  // token dễ vượt 45s. Cho claude-cli timeout rộng (mặc định 540s, chỉnh qua
  // BRIDGE_TIMEOUT_MS); adapter API trực tiếp giữ 45s. opts.timeoutMs ưu tiên.
  const timeoutMs =
    opts.timeoutMs ??
    (p.adapter === "claude-cli" ? Number(process.env.BRIDGE_TIMEOUT_MS) || 540_000 : 45_000);

  // claude-cli dùng local bridge (localhost:8909/v1/messages) — Anthropic format, không cần API key.
  const isAnthropic = ["claude", "claude-pro", "anthropic", "claude-cli"].includes(p.adapter);
  const key =
    (p.apiKeyEnc ? decryptSecret(p.apiKeyEnc) : "") ||
    process.env[isAnthropic ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"] ||
    "";
  if (!key && p.adapter !== "ollama" && p.adapter !== "claude-cli") {
    return {
      output: null,
      usageIn: 0,
      usageOut: 0,
      error: `no_api_key: profile "${p.name}" (adapter=${p.adapter}) chưa có API key. Set trong Settings → LLM, hoặc env ${isAnthropic ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"}`,
    };
  }

  // Endpoint phải là URL tuyệt đối — relative path (vd "/bridge/") hoạt động trên
  // browser nhưng Node.js fetch sẽ throw "Failed to parse URL". Sanitize về default.
  const safeEndpoint = (v: string | null | undefined, fallback: string) =>
    v && (v.startsWith("http://") || v.startsWith("https://")) ? v : fallback;

  let raw = "";
  let usageIn = 0;
  let usageOut = 0;
  try {
    if (isAnthropic) {
      // Bridge là infra service — địa chỉ do deployment quyết định, KHÔNG do
      // profile (profile.endpoint phản ánh góc nhìn browser: "/bridge" proxy
      // qua nginx, hoặc "http://localhost:8909" của máy dev). Server-side ưu tiên:
      //   1. BRIDGE_URL env  — Docker compose set "http://bridge:8909"
      //   2. endpoint absolute đã lưu (nếu không có env — vd self-host khác)
      //   3. "http://localhost:8909" — local dev: server chạy NGOÀI Docker
      // Nhờ vậy "/bridge" relative (Node fetch không parse được) hay
      // "localhost:8909" sai-trong-Docker đều được thay bằng địa chỉ đúng.
      const endpointBase =
        p.adapter === "claude-cli"
          ? process.env.BRIDGE_URL || safeEndpoint(p.endpoint, "http://localhost:8909")
          : safeEndpoint(p.endpoint, "https://api.anthropic.com");
      const endpoint = endpointBase + "/v1/messages";
      const headers: Record<string, string> = {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      };
      if (key) headers["x-api-key"] = key;
      const r = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: p.model,
          max_tokens: maxTokens,
          temperature,
          system: opts.system,
          messages: [{ role: "user", content: user }],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        return {
          output: null,
          usageIn: 0,
          usageOut: 0,
          error: `http_${r.status}: ${text.slice(0, 500)}`,
          raw: text,
        };
      }
      const j = (await r.json()) as {
        content?: Array<{ text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      raw = j.content?.[0]?.text ?? "";
      usageIn = j.usage?.input_tokens ?? 0;
      usageOut = j.usage?.output_tokens ?? 0;
    } else {
      const endpoint = safeEndpoint(p.endpoint, "https://api.openai.com") + "/v1/chat/completions";
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (key) headers.authorization = `Bearer ${key}`;
      const r = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: p.model,
          max_tokens: maxTokens,
          temperature,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        return {
          output: null,
          usageIn: 0,
          usageOut: 0,
          error: `http_${r.status}: ${text.slice(0, 500)}`,
          raw: text,
        };
      }
      const j = (await r.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      raw = j.choices?.[0]?.message?.content ?? "";
      usageIn = j.usage?.prompt_tokens ?? 0;
      usageOut = j.usage?.completion_tokens ?? 0;
    }
  } catch (e) {
    const msg = (e as Error).message;
    console.warn("[llm-json] fetch lỗi:", msg);
    return {
      output: null,
      usageIn: 0,
      usageOut: 0,
      error: msg.includes("timeout")
        ? `timeout: API > ${Math.round(timeoutMs / 1000)}s`
        : `fetch_error: ${msg}`,
    };
  }

  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) {
    return {
      output: null,
      usageIn,
      usageOut,
      error: `no_json: response không chứa JSON object. Raw output ${raw.length} chars`,
      raw,
    };
  }
  try {
    return { output: JSON.parse(m[0]) as T, usageIn, usageOut };
  } catch (e) {
    return {
      output: null,
      usageIn,
      usageOut,
      error: `parse_fail: ${(e as Error).message}`,
      raw,
    };
  }
}
