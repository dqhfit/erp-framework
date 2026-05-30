/* ==========================================================
   agent-chat.ts — Vòng lặp agent phía SERVER: gọi LLM + thực thi
   MCP tool, phát event theo từng bước (text / tool_call /
   tool_result / done / error). Route SSE trong index.ts stream
   các event này về trình duyệt.
   Hỗ trợ Anthropic (content-block tools) và OpenAI-compatible
   (function-calling — gồm cả ollama qua endpoint OpenAI-compat).
   ========================================================== */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { llmProfiles } from "@erp-framework/db";
import { inferAdapterFromModel, adapterFamily } from "@erp-framework/core";
import type { DB } from "./db";
import { decryptSecret } from "./crypto";

// inferAdapterFromModel + adapterFamily đã chuyển sang @erp-framework/core
// để client (UI dropdown) và server (chọn profile) dùng chung nguồn.

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
type AnthMsg = { role: "user" | "assistant"; content: string | Block[] };

export interface ToolDef {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
}
export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; result?: unknown; error?: string }
  | { type: "done"; text: string; usage: { input: number; output: number } }
  | { type: "error"; message: string };

export interface AgentChatOpts {
  db: DB;
  /** Công ty đang chọn — chọn LLM profile trong phạm vi công ty này. */
  companyId: string;
  /** User hiện tại — ưu tiên profile CÁ NHÂN (runtime="server") của user,
   *  fallback profile công ty. Bỏ qua → chỉ profile công ty. */
  userId?: string;
  profileName?: string;
  /** Override model — chọn profile theo adapter suy ra từ model thay
     vì theo profileName. Dùng cho agent có model + fallback list. */
  modelOverride?: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  tools: ToolDef[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  onEvent: (e: AgentEvent) => void;
}

interface ProfileRow {
  adapter: string;
  model: string;
  endpoint: string | null;
  apiKeyEnc: string | null;
  temperature: number | null;
  maxTokens: number | null;
}

const MAX_ROUNDS = 6;
const TRIM = 8000;
const trim = (s: string) => (s.length > TRIM ? s.slice(0, TRIM) + "\n…[cắt bớt]" : s);

/* ─── Anthropic (content-block tools) ─────────────────────── */
interface AnthropicResp {
  content?: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

async function anthropicLoop(opt: AgentChatOpts, p: ProfileRow, key: string): Promise<void> {
  // claude-cli gọi bridge cục bộ (BRIDGE_URL env hoặc bridge:8909), KHÔNG phải
  // api.anthropic.com; endpoint "/bridge" (góc nhìn browser) server không parse được.
  const safeUrl = (v: string | null, fb: string) =>
    v && (v.startsWith("http://") || v.startsWith("https://")) ? v : fb;
  const base = (
    p.adapter === "claude-cli"
      ? process.env.BRIDGE_URL || safeUrl(p.endpoint, "http://localhost:8909")
      : p.endpoint || "https://api.anthropic.com"
  ).replace(/\/$/, "");
  const messages: AnthMsg[] = opt.messages.map((m) => ({ role: m.role, content: m.content }));
  const tools = opt.tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.schema,
  }));
  const total = { input: 0, output: 0 };

  for (let i = 0; i < MAX_ROUNDS; i++) {
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
        system: opt.system,
        messages,
        ...(tools.length ? { tools } : {}),
      }),
    });
    if (!res.ok) {
      opt.onEvent({
        type: "error",
        message: `Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`,
      });
      return;
    }
    const j = (await res.json()) as AnthropicResp;
    total.input += j.usage?.input_tokens ?? 0;
    total.output += j.usage?.output_tokens ?? 0;
    const blocks = j.content ?? [];
    const text = blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    const toolUses = blocks.filter((b) => b.type === "tool_use");
    if (text) opt.onEvent({ type: "text", text });

    if (j.stop_reason !== "tool_use" || toolUses.length === 0) {
      opt.onEvent({ type: "done", text, usage: total });
      return;
    }
    messages.push({ role: "assistant", content: blocks as Block[] });
    const resultBlocks: Block[] = [];
    for (const tu of toolUses) {
      const name = tu.name ?? "";
      const args = tu.input ?? {};
      opt.onEvent({ type: "tool_call", name, args });
      try {
        const out = await opt.callTool(name, args);
        const c = typeof out === "string" ? out : JSON.stringify(out);
        opt.onEvent({ type: "tool_result", name, result: out });
        resultBlocks.push({ type: "tool_result", tool_use_id: tu.id ?? "", content: trim(c) });
      } catch (e) {
        const msg = (e as Error).message;
        opt.onEvent({ type: "tool_result", name, error: msg });
        resultBlocks.push({
          type: "tool_result",
          tool_use_id: tu.id ?? "",
          content: "ERROR: " + msg,
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: resultBlocks });
  }
  opt.onEvent({ type: "done", text: `(đạt giới hạn ${MAX_ROUNDS} vòng)`, usage: total });
}

/* ─── OpenAI-compatible (function-calling) ────────────────── */
interface OpenAiResp {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

async function openaiLoop(opt: AgentChatOpts, p: ProfileRow, key: string): Promise<void> {
  const base = (p.endpoint || "https://api.openai.com").replace(/\/$/, "");
  const msgs: Array<Record<string, unknown>> = [
    { role: "system", content: opt.system },
    ...opt.messages.map((m) => ({ role: m.role, content: m.content })),
  ];
  const tools = opt.tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description ?? "", parameters: t.schema },
  }));
  const total = { input: 0, output: 0 };

  for (let i = 0; i < MAX_ROUNDS; i++) {
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
        messages: msgs,
        ...(tools.length ? { tools } : {}),
      }),
    });
    if (!res.ok) {
      opt.onEvent({
        type: "error",
        message: `OpenAI-compat ${res.status}: ${(await res.text()).slice(0, 300)}`,
      });
      return;
    }
    const j = (await res.json()) as OpenAiResp;
    total.input += j.usage?.prompt_tokens ?? 0;
    total.output += j.usage?.completion_tokens ?? 0;
    const choice = j.choices?.[0];
    const m = choice?.message ?? {};
    const text = m.content ?? "";
    const toolCalls = m.tool_calls ?? [];
    if (text) opt.onEvent({ type: "text", text });

    if (choice?.finish_reason !== "tool_calls" || toolCalls.length === 0) {
      opt.onEvent({ type: "done", text, usage: total });
      return;
    }
    msgs.push(m as Record<string, unknown>);
    for (const tc of toolCalls) {
      const name = tc.function?.name ?? "";
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function?.arguments ?? "{}") as Record<string, unknown>;
      } catch {
        /* arguments không phải JSON hợp lệ */
      }
      opt.onEvent({ type: "tool_call", name, args });
      try {
        const out = await opt.callTool(name, args);
        const c = typeof out === "string" ? out : JSON.stringify(out);
        opt.onEvent({ type: "tool_result", name, result: out });
        msgs.push({ role: "tool", tool_call_id: tc.id ?? "", content: trim(c) });
      } catch (e) {
        const msg = (e as Error).message;
        opt.onEvent({ type: "tool_result", name, error: msg });
        msgs.push({ role: "tool", tool_call_id: tc.id ?? "", content: "ERROR: " + msg });
      }
    }
  }
  opt.onEvent({ type: "done", text: `(đạt giới hạn ${MAX_ROUNDS} vòng)`, usage: total });
}

/* ─── Entry — chọn vòng lặp theo adapter ──────────────────── */
export async function runAgentChat(opt: AgentChatOpts): Promise<void> {
  // Chọn LLM profile:
  // - modelOverride: chọn theo adapter suy ra từ model (cho agent
  //   có model riêng + fallback).
  // - profileName: chọn theo tên (luồng AgentPanel cũ).
  let p:
    | {
        adapter: string;
        model: string;
        endpoint: string | null;
        apiKeyEnc: string | null;
        temperature: number | null;
        maxTokens: number | null;
      }
    | undefined;
  // Scope profile: ưu tiên CÁ NHÂN của user (runtime="server" — server gọi
  // được; "browser" là model local máy user nên server bỏ qua), fallback CÔNG
  // TY (user_id NULL); KHÔNG vớ profile cá nhân của user khác.
  const scope = opt.userId
    ? or(
        and(eq(llmProfiles.userId, opt.userId), eq(llmProfiles.runtime, "server")),
        isNull(llmProfiles.userId),
      )
    : isNull(llmProfiles.userId);
  const preferPersonal = sql`${llmProfiles.userId} IS NULL`; // personal (false) xếp trước
  if (opt.modelOverride) {
    const family = adapterFamily(inferAdapterFromModel(opt.modelOverride));
    const rows = await opt.db
      .select()
      .from(llmProfiles)
      .where(
        and(
          eq(llmProfiles.companyId, opt.companyId),
          eq(llmProfiles.kind, "chat"),
          inArray(llmProfiles.adapter, family),
          scope,
        ),
      )
      .orderBy(preferPersonal)
      .limit(1);
    if (rows[0]) p = { ...rows[0], model: opt.modelOverride };
  } else {
    const rows = await opt.db
      .select()
      .from(llmProfiles)
      .where(
        and(
          eq(llmProfiles.companyId, opt.companyId),
          opt.profileName ? eq(llmProfiles.name, opt.profileName) : undefined,
          scope,
        ),
      )
      .orderBy(preferPersonal)
      .limit(1);
    p = rows[0];
  }
  if (!p) {
    opt.onEvent({
      type: "error",
      message: opt.modelOverride
        ? `Không tìm thấy LLM profile cho model "${opt.modelOverride}" — thêm profile cùng adapter ở Cài đặt → LLM.`
        : "Chưa có LLM profile trên server — vào Cấu hình LLM lưu một profile (cần API key).",
    });
    return;
  }
  // claude-cli: format Anthropic nhưng gọi qua bridge cục bộ (BRIDGE_URL /
  // bridge:8909), KHÔNG cần API key — gom vào nhánh Anthropic.
  const isAnthropic =
    p.adapter === "claude" ||
    p.adapter === "claude-pro" ||
    p.adapter === "anthropic" ||
    p.adapter === "claude-cli";
  const isOpenAi = p.adapter === "openai" || p.adapter === "ollama";
  if (!isAnthropic && !isOpenAi) {
    opt.onEvent({ type: "error", message: `Adapter "${p.adapter}" chưa hỗ trợ ở agent backend.` });
    return;
  }
  const key =
    (p.apiKeyEnc ? decryptSecret(p.apiKeyEnc) : "") ||
    process.env[isAnthropic ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"] ||
    "";
  // ollama (local) + claude-cli (bridge) không cần key.
  if (!key && p.adapter !== "ollama" && p.adapter !== "claude-cli") {
    opt.onEvent({ type: "error", message: "LLM profile thiếu API key." });
    return;
  }
  if (isAnthropic) await anthropicLoop(opt, p, key);
  else await openaiLoop(opt, p, key);
}
