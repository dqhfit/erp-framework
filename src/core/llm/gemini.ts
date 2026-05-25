import type { LLMRequest, LLMResponse } from "@/types/llm";
import { LLMAdapterBase } from "./adapter";

export class GeminiAdapter extends LLMAdapterBase {
  constructor() {
    super("gemini", {
      tools: true,
      vision: true,
      json_mode: true,
      streaming: true,
      max_input_tokens: 1_000_000,
      max_output_tokens: 8_192,
    });
  }
  async send(req: LLMRequest): Promise<LLMResponse> {
    const model = req.model || "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${req.apiKey}`;
    const contents = req.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : m.role,
      parts: [{ text: m.content }],
    }));
    const body = {
      systemInstruction: req.system ? { parts: [{ text: req.system }] } : undefined,
      contents,
      generationConfig: {
        temperature: req.temperature ?? 0.7,
        maxOutputTokens: req.max_tokens ?? 4_096,
        responseMimeType: req.response_format === "json" ? "application/json" : undefined,
      },
      tools: req.tools
        ? [
            {
              functionDeclarations: req.tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: t.schema,
              })),
            },
          ]
        : undefined,
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      candidates: Array<{
        content: {
          parts: Array<{
            text?: string;
            functionCall?: { name: string; args: Record<string, unknown> };
          }>;
        };
      }>;
      usageMetadata: { promptTokenCount: number; candidatesTokenCount: number };
    };
    const parts = data.candidates[0]?.content?.parts ?? [];
    const text = parts
      .filter((p) => p.text)
      .map((p) => p.text)
      .join("");
    const calls = parts
      .filter((p) => p.functionCall)
      .map((p) => ({
        name: p.functionCall?.name,
        input: p.functionCall?.args,
      }));
    return {
      text,
      tool_calls: this.normalizeToolCalls(calls),
      usage: {
        input_tokens: data.usageMetadata.promptTokenCount,
        output_tokens: data.usageMetadata.candidatesTokenCount,
      },
      raw: data,
    };
  }
}
