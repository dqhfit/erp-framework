import type { LLMAdapter, LLMCapabilities, LLMRequest, LLMResponse, ToolCall } from "@/types/llm";

export abstract class LLMAdapterBase implements LLMAdapter {
  readonly id: string;
  readonly capabilities: LLMCapabilities;

  constructor(id: string, capabilities: Partial<LLMCapabilities> = {}) {
    this.id = id;
    this.capabilities = {
      tools: false,
      vision: false,
      json_mode: false,
      streaming: false,
      max_input_tokens: 8_000,
      max_output_tokens: 4_096,
      ...capabilities,
    };
  }

  abstract send(req: LLMRequest): Promise<LLMResponse>;

  protected normalizeToolCalls(raw: Array<Record<string, unknown>>): ToolCall[] {
    return raw.map((tc) => {
      const fn = tc.function as { name?: string; arguments?: string } | undefined;
      const name = (tc.name as string) ?? fn?.name ?? "";
      let args: Record<string, unknown> = {};
      if (typeof tc.input === "object" && tc.input) args = tc.input as Record<string, unknown>;
      else if (typeof tc.arguments === "string") {
        try {
          args = JSON.parse(tc.arguments);
        } catch {}
      } else if (typeof fn?.arguments === "string") {
        try {
          args = JSON.parse(fn.arguments);
        } catch {}
      }
      return { id: (tc.id as string) ?? undefined, name, args };
    });
  }
}
