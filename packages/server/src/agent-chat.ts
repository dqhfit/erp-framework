/* ==========================================================
   agent-chat.ts — Vòng lặp agent phía SERVER: gọi LLM + thực thi
   MCP tool, phát event theo từng bước (text / tool_call /
   tool_result / done). Route SSE trong index.ts stream các event
   này về trình duyệt → chat "chảy" theo tiến trình thật.
   Hiện hỗ trợ adapter Anthropic (agent mẫu dùng claude).
   ========================================================== */
import { eq } from "drizzle-orm";
import { llmProfiles } from "@erp-framework/db";
import type { DB } from "./db";
import { decryptSecret } from "./crypto";

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
type Msg = { role: "user" | "assistant"; content: string | Block[] };

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
  profileName?: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  tools: ToolDef[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  onEvent: (e: AgentEvent) => void;
}

interface AnthropicResp {
  content?: Array<{
    type: string; text?: string;
    id?: string; name?: string; input?: Record<string, unknown>;
  }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const MAX_ROUNDS = 6;

export async function runAgentChat(opt: AgentChatOpts): Promise<void> {
  const rows = await opt.db.select().from(llmProfiles)
    .where(opt.profileName ? eq(llmProfiles.name, opt.profileName) : undefined)
    .limit(1);
  const p = rows[0];
  if (!p) {
    opt.onEvent({ type: "error", message: "Chưa có LLM profile trên server — vào Cấu hình LLM lưu một profile (cần API key)." });
    return;
  }
  if (p.adapter !== "claude" && p.adapter !== "claude-pro" && p.adapter !== "anthropic") {
    opt.onEvent({ type: "error", message: `Adapter "${p.adapter}" chưa hỗ trợ ở agent backend (hiện chỉ Anthropic).` });
    return;
  }
  const key = (p.apiKeyEnc ? decryptSecret(p.apiKeyEnc) : "")
    || process.env.ANTHROPIC_API_KEY || "";
  if (!key) {
    opt.onEvent({ type: "error", message: "LLM profile thiếu API key." });
    return;
  }
  const base = (p.endpoint || "https://api.anthropic.com").replace(/\/$/, "");

  const messages: Msg[] = opt.messages.map((m) => ({ role: m.role, content: m.content }));
  const anthTools = opt.tools.map((t) => ({
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
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: p.model,
        max_tokens: p.maxTokens ?? 4096,
        temperature: p.temperature ?? 0.7,
        system: opt.system,
        messages,
        ...(anthTools.length ? { tools: anthTools } : {}),
      }),
    });
    if (!res.ok) {
      opt.onEvent({ type: "error", message: `Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}` });
      return;
    }
    const j = (await res.json()) as AnthropicResp;
    total.input += j.usage?.input_tokens ?? 0;
    total.output += j.usage?.output_tokens ?? 0;
    const blocks = j.content ?? [];
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    const toolUses = blocks.filter((b) => b.type === "tool_use");
    if (text) opt.onEvent({ type: "text", text });

    if (j.stop_reason !== "tool_use" || toolUses.length === 0) {
      opt.onEvent({ type: "done", text, usage: total });
      return;
    }

    // Phản hồi của model (text + tool_use) đưa lại vào hội thoại.
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
        resultBlocks.push({
          type: "tool_result", tool_use_id: tu.id ?? "",
          content: c.length > 8000 ? c.slice(0, 8000) + "\n…[cắt bớt]" : c,
        });
      } catch (e) {
        const msg = (e as Error).message;
        opt.onEvent({ type: "tool_result", name, error: msg });
        resultBlocks.push({
          type: "tool_result", tool_use_id: tu.id ?? "",
          content: "ERROR: " + msg, is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: resultBlocks });
  }
  opt.onEvent({
    type: "done",
    text: `(đạt giới hạn ${MAX_ROUNDS} vòng — agent có thể đang loop)`,
    usage: total,
  });
}
