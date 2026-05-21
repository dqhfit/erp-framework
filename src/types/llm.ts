export type Role = "system" | "user" | "assistant";

export interface ToolDef {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
}
export interface ToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}
export interface LLMRequest {
  model?: string;
  system?: string;
  messages: Array<{ role: Role; content: string }>;
  tools?: ToolDef[];
  temperature?: number;
  max_tokens?: number;
  apiKey?: string;
  endpoint?: string;
  response_format?: "text" | "json";
}
export interface LLMResponse {
  text: string;
  tool_calls: ToolCall[];
  usage: { input_tokens: number; output_tokens: number };
  raw: unknown;
}
export interface LLMCapabilities {
  tools: boolean;
  vision: boolean;
  json_mode: boolean;
  streaming: boolean;
  max_input_tokens: number;
  max_output_tokens: number;
}
export interface LLMAdapter {
  readonly id: string;
  readonly capabilities: LLMCapabilities;
  send(req: LLMRequest): Promise<LLMResponse>;
}
export interface LLMProfile {
  name: string;
  adapter: string;
  model: string;
  apiKey?: string;
  endpoint?: string;
  temperature?: number;
  max_tokens?: number;
}
