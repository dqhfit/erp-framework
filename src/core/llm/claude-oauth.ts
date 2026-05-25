import type { LLMRequest, LLMResponse } from "@/types/llm";
import { LLMAdapterBase } from "./adapter";
import { getAccessToken } from "./oauth";

/**
 * ClaudeOAuthAdapter — dùng OAuth bearer token thay vì API key.
 * Phù hợp cho user có gói Claude Pro/Max và muốn dùng quota subscription.
 */
export class ClaudeOAuthAdapter extends LLMAdapterBase {
  constructor() {
    super("claude-pro", {
      tools: true,
      vision: true,
      streaming: true,
      max_input_tokens: 200_000,
      max_output_tokens: 8_192,
    });
  }

  async send(req: LLMRequest): Promise<LLMResponse> {
    const token = await getAccessToken();
    const body = {
      model: req.model || "claude-sonnet-4-6",
      max_tokens: req.max_tokens ?? 4_096,
      temperature: req.temperature ?? 0.7,
      system: req.system,
      messages: req.messages,
      tools: req.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.schema,
      })),
    };
    const res = await fetch(req.endpoint ?? "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      if (res.status === 401) {
        throw new Error("Token hết hạn / không hợp lệ. Vui lòng đăng nhập lại Claude Pro/Max.");
      }
      throw new Error(`Claude API ${res.status}: ${errText}`);
    }
    const data = (await res.json()) as {
      content: Array<{
        type: string;
        text?: string;
        name?: string;
        id?: string;
        input?: Record<string, unknown>;
      }>;
      usage: { input_tokens: number; output_tokens: number };
    };
    const textBlock = data.content.find((b) => b.type === "text");
    const toolBlocks = data.content.filter((b) => b.type === "tool_use");
    return {
      text: textBlock?.text ?? "",
      tool_calls: this.normalizeToolCalls(
        toolBlocks.map((b) => ({ id: b.id, name: b.name, input: b.input })),
      ),
      usage: data.usage,
      raw: data,
    };
  }
}
