/* ==========================================================
   llm-json.ts — Gọi LLM một shot, kỳ vọng response JSON.
   Helper chung cho các AI generator (feedback summary/tags,
   enum values, procedure code…). Tự chọn llmProfiles mặc định
   của công ty; hỗ trợ Anthropic + OpenAI/Ollama-compat.
   Fail-safe: trả null khi profile thiếu/LLM fail/JSON không parse được.
   ========================================================== */
import { and, eq, isNull } from "drizzle-orm";
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
  /** Override timeout (ms). Mặc định 180s cho claude-cli (CLI subprocess
   *  chậm), 45s cho adapter API trực tiếp. */
  timeoutMs?: number;
  /** User hiện tại — nếu có, ưu tiên profile CÁ NHÂN (runtime="server") của
   *  user, fallback profile công ty. Bỏ qua → chỉ dùng profile công ty. */
  userId?: string;
}

/** Resolve profile chat: ưu tiên CÁ NHÂN của user (runtime="server" — server
 *  gọi được; "browser" là model local máy user nên server bỏ qua), fallback
 *  CÔNG TY (user_id NULL). */
export async function resolveChatProfile(
  db: DB,
  companyId: string,
  opts: { profileName?: string; userId?: string },
): Promise<typeof llmProfiles.$inferSelect | null> {
  const base = [eq(llmProfiles.companyId, companyId), eq(llmProfiles.kind, "chat")];
  if (opts.profileName) base.push(eq(llmProfiles.name, opts.profileName));
  if (opts.userId) {
    const [personal] = await db
      .select()
      .from(llmProfiles)
      .where(and(...base, eq(llmProfiles.userId, opts.userId), eq(llmProfiles.runtime, "server")))
      .limit(1);
    if (personal) return personal;
  }
  const [company] = await db
    .select()
    .from(llmProfiles)
    .where(and(...base, isNull(llmProfiles.userId)))
    .limit(1);
  return company ?? null;
}

/** Gọi LLM 1 shot. Trả object đã parse, hoặc null nếu lỗi/không hợp lệ.
 *  Generic <T>: caller annotate kiểu kỳ vọng để TS hỗ trợ. */
export async function callLlmJson<T = unknown>(
  db: DB,
  companyId: string,
  opts: CallLlmJsonOpts,
): Promise<T | null> {
  const p = await resolveChatProfile(db, companyId, opts);
  if (!p) return null;

  const user = opts.user.slice(0, 8000);
  const maxTokens = opts.maxTokens ?? 1024;
  const temperature = opts.temperature ?? 0.2;
  // Bridge (claude-cli) chạy CLI subprocess — ~2k token đã ~38s, sinh nhiều
  // token dễ vượt 45s. Cho claude-cli timeout rộng (mặc định 180s, chỉnh qua
  // BRIDGE_TIMEOUT_MS); adapter API trực tiếp giữ 45s. opts.timeoutMs ưu tiên.
  const timeoutMs =
    opts.timeoutMs ??
    (p.adapter === "claude-cli" ? Number(process.env.BRIDGE_TIMEOUT_MS) || 180_000 : 45_000);

  // claude-cli dùng local bridge (localhost:8909/v1/messages) — Anthropic format, không cần API key.
  const isAnthropic = ["claude", "claude-pro", "anthropic", "claude-cli"].includes(p.adapter);
  const key =
    (p.apiKeyEnc ? decryptSecret(p.apiKeyEnc) : "") ||
    process.env[isAnthropic ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"] ||
    "";
  if (!key && p.adapter !== "ollama" && p.adapter !== "claude-cli") return null;

  // Endpoint phải là URL tuyệt đối — relative path (vd "/bridge/") hoạt động trên
  // browser nhưng Node.js fetch sẽ throw "Failed to parse URL". Sanitize về default.
  const safeEndpoint = (v: string | null | undefined, fallback: string) =>
    v && (v.startsWith("http://") || v.startsWith("https://")) ? v : fallback;

  let raw = "";
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
      if (!r.ok) return null;
      const j = (await r.json()) as { content?: Array<{ text?: string }> };
      raw = j.content?.[0]?.text ?? "";
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
