import type { LLMRequest, LLMResponse } from "@/types/llm";
import { LLMAdapterBase } from "./adapter";

/**
 * ClaudeCliAdapter — gọi Claude qua local Node bridge (scripts/claude-bridge.mjs)
 * Bridge spawn `claude -p` CLI, dùng auth của Claude Code (Pro/Max session
 * hoặc API key đã setup). Browser → http://localhost:8909/v1/messages.
 */
export class ClaudeCliAdapter extends LLMAdapterBase {
  constructor() {
    super("claude-cli", {
      tools: false,
      vision: false,
      json_mode: false,
      streaming: false,
      max_input_tokens: 200_000,
      max_output_tokens: 8_192,
    });
  }

  /** Default bridge URL — user có thể override qua profile.endpoint */
  private defaultBridgeUrl() {
    return localStorage.getItem("claude-cli-bridge-url") || "http://localhost:8909";
  }

  async send(req: LLMRequest): Promise<LLMResponse> {
    const base = req.endpoint || this.defaultBridgeUrl();
    const url = `${base.replace(/\/$/, "")}/v1/messages`;
    const body = {
      model: req.model || "claude-sonnet-4-6",
      max_tokens: req.max_tokens ?? 4_096,
      system: req.system,
      messages: req.messages,
    };
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (_e) {
      throw new Error(
        `Không kết nối được Claude CLI bridge tại ${base}. Chạy 'node scripts/claude-bridge.mjs' trước.`,
      );
    }
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Bridge ${res.status}: ${t}`);
    }
    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };
    const textBlock = data.content?.find((b) => b.type === "text");
    return {
      text: textBlock?.text ?? "",
      tool_calls: [],
      usage: data.usage ?? { input_tokens: 0, output_tokens: 0 },
      raw: data,
    };
  }

  /** Check bridge có chạy không */
  static async healthCheck(url?: string): Promise<boolean> {
    const base = url || localStorage.getItem("claude-cli-bridge-url") || "http://localhost:8909";
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
