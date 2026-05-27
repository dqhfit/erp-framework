/* ==========================================================
   llm-json.ts — Gọi LLM 1 shot, kỳ vọng response JSON.

   Port từ packages/server/src/llm-json.ts vì migration-cli
   không thể import @erp-framework/server (circular dep). Logic
   y hệt — chọn llm_profile kind=chat đầu tiên của company,
   Anthropic + OpenAI/Ollama adapter, fail-safe trả null.
   ========================================================== */

import { and, eq } from "drizzle-orm";
import { llmProfiles } from "@erp-framework/db";
import type { DB } from "./db.js";
import { decryptSecret } from "./crypto.js";

export interface CallLlmJsonOpts {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  profileName?: string;
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
  const conds = [eq(llmProfiles.companyId, companyId), eq(llmProfiles.kind, "chat")];
  if (opts.profileName) conds.push(eq(llmProfiles.name, opts.profileName));
  const [p] = await db
    .select()
    .from(llmProfiles)
    .where(and(...conds))
    .limit(1);
  if (!p) {
    return {
      output: null,
      usageIn: 0,
      usageOut: 0,
      error: `no_profile: company chưa có llm_profile kind=chat${opts.profileName ? ` tên "${opts.profileName}"` : ""}. Vào Settings → LLM để thêm`,
    };
  }

  const user = opts.user.slice(0, 8000);
  const maxTokens = opts.maxTokens ?? 1024;
  const temperature = opts.temperature ?? 0.2;

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

  let raw = "";
  let usageIn = 0;
  let usageOut = 0;
  try {
    if (isAnthropic) {
      const endpoint = (p.endpoint ?? "https://api.anthropic.com") + "/v1/messages";
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
        signal: AbortSignal.timeout(45_000),
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
      const endpoint = (p.endpoint ?? "https://api.openai.com") + "/v1/chat/completions";
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
        signal: AbortSignal.timeout(45_000),
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
      error: msg.includes("timeout") ? "timeout: API > 45s" : `fetch_error: ${msg}`,
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
