import { LLMAdapterBase } from "./adapter";
import type { LLMRequest, LLMResponse } from "@/types/llm";

export class OllamaAdapter extends LLMAdapterBase {
  constructor() {
    super("ollama", {
      tools: true, json_mode: true, streaming: true,
      max_input_tokens: 8_000, max_output_tokens: 4_096,
    });
  }
  async send(req: LLMRequest): Promise<LLMResponse> {
    const messages = req.system
      ? [{ role: "system", content: req.system }, ...req.messages]
      : req.messages;
    const body = {
      model: req.model || "llama3",
      messages,
      stream: false,
      options: { temperature: req.temperature ?? 0.7, num_predict: req.max_tokens ?? 4_096 },
      format: req.response_format === "json" ? "json" : undefined,
    };
    const res = await fetch(req.endpoint ?? "http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const data = await res.json() as {
      message: { content: string };
      prompt_eval_count?: number; eval_count?: number;
    };
    return {
      text: data.message.content,
      tool_calls: [],
      usage: { input_tokens: data.prompt_eval_count ?? 0, output_tokens: data.eval_count ?? 0 },
      raw: data,
    };
  }
}
