/* ==========================================================
   llm-adapter.ts — Helper suy adapter từ tên model. Dùng cả
   client (UI dropdown + group optgroup) lẫn server (chọn LLM
   profile theo họ adapter trong /agent/chat & heartbeat).
   Cố ý là PURE function — không phụ thuộc store, DB hay React.
   ========================================================== */

/** Danh sách adapter chuẩn — UI dùng làm nhãn `<optgroup>`,
   server dùng làm khoá tra llm_profiles. */
export const LLM_ADAPTERS = [
  "claude", "claude-pro", "claude-cli",
  "openai", "gemini", "ollama",
] as const;

export type LlmAdapter = typeof LLM_ADAPTERS[number];

/** Suy adapter từ tên model. Mặc định "claude" khi không match. */
export function inferAdapterFromModel(
  model: string | null | undefined,
): LlmAdapter {
  if (!model) return "claude";
  if (model.startsWith("claude-")) return "claude";
  if (model.startsWith("gpt-") || /^o[1-9]/.test(model)) return "openai";
  if (model.startsWith("gemini-")) return "gemini";
  if (model.includes(":") || model.startsWith("llama")
    || model.startsWith("mistral") || model.startsWith("qwen")) {
    return "ollama";
  }
  return "claude";
}

/** Họ adapter — server gộp claude/claude-pro/claude-cli/anthropic
   thành cùng họ khi tra llm_profiles. */
export function adapterFamily(adapter: string): string[] {
  if (adapter === "claude" || adapter === "claude-pro"
    || adapter === "claude-cli" || adapter === "anthropic") {
    return ["claude", "claude-pro", "claude-cli", "anthropic"];
  }
  return [adapter];
}
