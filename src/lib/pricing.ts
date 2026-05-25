/* ==========================================================
   pricing.ts — Bảng giá token (USD / 1 triệu token) để ước
   tính chi phí mỗi lần gọi LLM. Giá tham khảo, có thể lệch.
   ========================================================== */

interface ModelPrice {
  input: number; // USD / 1M input tokens
  output: number; // USD / 1M output tokens
}

// Khớp theo prefix tên model
const PRICE_TABLE: Array<{ match: RegExp; price: ModelPrice }> = [
  { match: /claude-opus/i, price: { input: 15, output: 75 } },
  { match: /claude-sonnet/i, price: { input: 3, output: 15 } },
  { match: /claude-haiku/i, price: { input: 0.8, output: 4 } },
  { match: /^o[1-9]/i, price: { input: 15, output: 60 } },
  { match: /gpt-4o-mini/i, price: { input: 0.15, output: 0.6 } },
  { match: /gpt-4o/i, price: { input: 2.5, output: 10 } },
  { match: /gpt-4/i, price: { input: 10, output: 30 } },
  { match: /gemini-.*pro/i, price: { input: 1.25, output: 5 } },
  { match: /gemini/i, price: { input: 0.1, output: 0.4 } },
];

const DEFAULT_PRICE: ModelPrice = { input: 1, output: 3 };

export function priceFor(model: string): ModelPrice {
  return PRICE_TABLE.find((p) => p.match.test(model))?.price ?? DEFAULT_PRICE;
}

/** Ước tính chi phí (USD) cho 1 lần gọi. Model nội bộ (ollama) → 0. */
export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  if (/llama|mistral|qwen|ollama/i.test(model)) return 0;
  const p = priceFor(model);
  return (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output;
}

/** Format USD gọn: $0.0123 hoặc $1.23 */
export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
