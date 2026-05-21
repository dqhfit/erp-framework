/* ==========================================================
   agent-runner.ts — Vòng lặp agent gọi LLM + thực thi MCP tool.
   - Build messages theo Anthropic content-block format
   - Mỗi iteration: send → nếu có tool_call → callTool → append
     tool_result → tiếp tục; nếu không có tool_call → return text
   - onProgress callback để UI hiển thị tool_call inline
   - Max 5 round mặc định
   ========================================================== */
import { llmRegistry } from "@/core/llm/registry";
import type { ToolDef } from "@/types/llm";

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

type Msg = { role: "user" | "assistant"; content: string | ContentBlock[] };

export type AgentEvent =
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; result: unknown; error?: string }
  | { type: "text_chunk"; text: string };

export interface AgentRunOptions {
  profileName: string;
  system: string;
  userPrompt: string;
  /** Lịch sử các turn trước (đã clean, content là string) */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  tools: ToolDef[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  maxIterations?: number;
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentRunResult {
  text: string;
  iterations: number;
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result: unknown; error?: string }>;
  totalUsage: { input_tokens: number; output_tokens: number };
}

export async function runAgent(opt: AgentRunOptions): Promise<AgentRunResult> {
  const maxIter = opt.maxIterations ?? 5;
  const messages: Msg[] = [];
  // Lịch sử trước (string content) — cast để TS không phàn nàn
  for (const h of opt.history ?? []) messages.push({ role: h.role, content: h.content });
  messages.push({ role: "user", content: opt.userPrompt });

  const total = { input_tokens: 0, output_tokens: 0 };
  const toolCalls: AgentRunResult["toolCalls"] = [];

  for (let i = 0; i < maxIter; i++) {
    const res = await llmRegistry.send(opt.profileName, {
      system: opt.system,
      // Content blocks được Anthropic API chấp nhận; type cast vì LLMRequest khai báo string
      messages: messages as unknown as Array<{ role: "user" | "assistant"; content: string }>,
      tools: opt.tools.length ? opt.tools : undefined,
    });
    total.input_tokens += res.usage.input_tokens;
    total.output_tokens += res.usage.output_tokens;

    if (!res.tool_calls?.length) {
      if (res.text) opt.onEvent?.({ type: "text_chunk", text: res.text });
      return { text: res.text, iterations: i + 1, toolCalls, totalUsage: total };
    }

    // Append assistant block: text (nếu có) + tool_use[]
    const assistantBlocks: ContentBlock[] = [];
    if (res.text) assistantBlocks.push({ type: "text", text: res.text });
    for (const tc of res.tool_calls) {
      assistantBlocks.push({
        type: "tool_use",
        id: tc.id ?? `tc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: tc.name,
        input: tc.args,
      });
    }
    messages.push({ role: "assistant", content: assistantBlocks });

    // Execute tools, build tool_result blocks
    const resultBlocks: ContentBlock[] = [];
    for (const tc of res.tool_calls) {
      const tcId = (assistantBlocks.find((b) => b.type === "tool_use" && b.name === tc.name) as
        Extract<ContentBlock, { type: "tool_use" }> | undefined)?.id
        ?? `tc_${Date.now()}`;
      opt.onEvent?.({ type: "tool_call", id: tcId, name: tc.name, args: tc.args });
      try {
        const out = await opt.callTool(tc.name, tc.args);
        const content = typeof out === "string" ? out : JSON.stringify(out);
        // Anthropic limit tool_result content; cắt cho an toàn
        const trimmed = content.length > 8000 ? content.slice(0, 8000) + "\n…[truncated]" : content;
        toolCalls.push({ name: tc.name, args: tc.args, result: out });
        opt.onEvent?.({ type: "tool_result", id: tcId, name: tc.name, result: out });
        resultBlocks.push({ type: "tool_result", tool_use_id: tcId, content: trimmed });
      } catch (e) {
        const msg = (e as Error).message;
        toolCalls.push({ name: tc.name, args: tc.args, result: null, error: msg });
        opt.onEvent?.({ type: "tool_result", id: tcId, name: tc.name, result: null, error: msg });
        resultBlocks.push({ type: "tool_result", tool_use_id: tcId, content: "ERROR: " + msg, is_error: true });
      }
    }
    messages.push({ role: "user", content: resultBlocks });
  }
  return {
    text: "(Đã đạt giới hạn " + maxIter + " vòng — agent có thể đang loop)",
    iterations: maxIter, toolCalls, totalUsage: total,
  };
}

/** Convert MCP tool definitions → ToolDef cho LLM adapter */
export function mcpToolsToToolDefs(
  mcpTools: Array<{ name: string; description?: string; inputSchema?: { type: string; properties?: Record<string, unknown>; required?: string[] } }>,
): ToolDef[] {
  return mcpTools.map((t) => ({
    name: t.name,
    description: t.description,
    schema: t.inputSchema ?? { type: "object", properties: {} },
  }));
}
