import { LLMAdapterBase } from "./adapter";
import type { LLMRequest, LLMResponse } from "@/types/llm";

export class ClaudeAdapter extends LLMAdapterBase {
  constructor() {
    super("claude", {
      tools: true, vision: true, streaming: true,
      max_input_tokens: 200_000, max_output_tokens: 8_192,
    });
  }

  async send(req: LLMRequest): Promise<LLMResponse> {
    const body = {
      model: req.model || "claude-sonnet-4-6",
      max_tokens: req.max_tokens ?? 4_096,
      temperature: req.temperature ?? 0.7,
      system: req.system,
      messages: req.messages,
      tools: req.tools?.map((t) => ({
        name: t.name, description: t.description, input_schema: t.schema,
      })),
    };
    const res = await fetch(req.endpoint ?? "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": req.apiKey ?? "",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
    const data = await res.json() as {
      content: Array<{ type: string; text?: string; name?: string; id?: string; input?: Record<string, unknown> }>;
      usage: { input_tokens: number; output_tokens: number };
    };
    const textBlock = data.content.find((b) => b.type === "text");
    const toolBlocks = data.content.filter((b) => b.type === "tool_use");
    return {
      text: textBlock?.text ?? "",
      tool_calls: this.normalizeToolCalls(toolBlocks.map((b) => ({ id: b.id, name: b.name, input: b.input }))),
      usage: data.usage,
      raw: data,
    };
  }
}
