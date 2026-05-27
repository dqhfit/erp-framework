/* ==========================================================
   llm-json.ts — Gọi LLM một shot, kỳ vọng response JSON.
   Helper chung cho các AI generator (feedback summary/tags,
   enum values, procedure code…). Tự chọn llmProfiles mặc định
   của công ty; hỗ trợ Anthropic + OpenAI/Ollama-compat.
   Fail-safe: trả null khi profile thiếu/LLM fail/JSON không parse được.
   ========================================================== */
import { and, eq } from "drizzle-orm";
import { llmProfiles } from "@erp-framework/db";
import type { DB } from "./db";
import { decryptSecret } from "./crypto";

export interface CallLlmJsonOpts {
  /** System prompt — mô tả task + định dạng JSON kỳ vọng. */
  system: string;
  /** User prompt — đầu vào (sẽ truncate 8000 ký tự). */
  user: string;
  /** Max tokens output (default 1024). */
  maxTokens?: number;
  /** Temperature (default 0.2 — ưu tiên xác định). */
  temperature?: number;
  /** Profile name; mặc định lấy profile chat đầu tiên của công ty. */
  profileName?: string;
}

/** Gọi LLM 1 shot. Trả object đã parse, hoặc null nếu lỗi/không hợp lệ.
 *  Generic <T>: caller annotate kiểu kỳ vọng để TS hỗ trợ. */
export async function callLlmJson<T = unknown>(
  db: DB,
  companyId: string,
  opts: CallLlmJsonOpts,
): Promise<T | null> {
  const conds = [eq(llmProfiles.companyId, companyId), eq(llmProfiles.kind, "chat")];
  if (opts.profileName) conds.push(eq(llmProfiles.name, opts.profileName));
  const [p] = await db
    .select()
    .from(llmProfiles)
    .where(and(...conds))
    .limit(1);
  if (!p) return null;

  const user = opts.user.slice(0, 8000);
  const maxTokens = opts.maxTokens ?? 1024;
  const temperature = opts.temperature ?? 0.2;

  // claude-cli dùng local bridge (localhost:8909/v1/messages) — Anthropic format, không cần API key.
  const isAnthropic = ["claude", "claude-pro", "anthropic", "claude-cli"].includes(p.adapter);
  const key =
    (p.apiKeyEnc ? decryptSecret(p.apiKeyEnc) : "") ||
    process.env[isAnthropic ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"] ||
    "";
  if (!key && p.adapter !== "ollama" && p.adapter !== "claude-cli") return null;

  let raw = "";
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
      if (!r.ok) return null;
      const j = (await r.json()) as { content?: Array<{ text?: string }> };
      raw = j.content?.[0]?.text ?? "";
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
      if (!r.ok) return null;
      const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
      raw = j.choices?.[0]?.message?.content ?? "";
    }
  } catch (e) {
    console.warn("[llm-json] fetch lỗi:", (e as Error).message);
    return null;
  }

  // Extract JSON đầu tiên — LLM đôi khi trả kèm markdown / lời mở đầu.
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}
