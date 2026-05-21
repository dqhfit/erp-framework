import { LLMAdapterBase } from "./adapter";
import type { LLMRequest, LLMResponse } from "@/types/llm";

export class OpenAIAdapter extends LLMAdapterBase {
  constructor() {
    super("openai", {
      tools: true, vision: true, json_mode: true, streaming: true,
      max_input_tokens: 128_000, max_output_tokens: 16_384,
    });
  }
  async send(req: LLMRequest): Promise<LLMResponse> {
    const messages = req.system
      ? [{ role: "system", content: req.system }, ...req.messages]
      : req.messages;
    const body = {
      model: req.model || "gpt-4o",
      max_tokens: req.max_tokens ?? 4_096,
      temperature: req.temperature ?? 0.7,
      messages,
      tools: req.tools?.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.schema },
      })),
      response_format: req.response_format === "json" ? { type: "json_object" } : undefined,
    };
    const res = await fetch(req.endpoint ?? "https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${req.apiKey ?? ""}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const data = await res.json() as {
      choices: Array<{ message: { content?: string; tool_calls?: Array<Record<string, unknown>> } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };
    const msg = data.choices[0]?.message ?? {};
    return {
      text: msg.content ?? "",
      tool_calls: this.normalizeToolCalls(msg.tool_calls ?? []),
      usage: { input_tokens: data.usage.prompt_tokens, output_tokens: data.usage.completion_tokens },
      raw: data,
    };
  }
}
