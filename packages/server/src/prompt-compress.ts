/* ==========================================================
   prompt-compress.ts — Nén prompt qua sidecar LLMLingua trước
   khi gọi LLM lớn. Giảm token input → tiết kiệm chi phí.

   Pattern giống extract.ts (gọi Tika): HTTP sidecar thuần,
   không phụ thuộc thư viện npm. Fail-safe: sidecar down → trả
   text gốc (không nén, không vỡ caller).
   ========================================================== */

import { splitUrlAuth } from "./url-auth";

// LLMLingua sidecar endpoint. Có thể đứng sau reverse-proxy basic-auth
// (giống Tika/Ollama pattern).
const { url: LLMLINGUA_URL, headers: LLMLINGUA_AUTH } = splitUrlAuth(
  process.env.LLMLINGUA_URL || "http://localhost:8908",
);

// Chỉ nén prompt dài hơn ngưỡng này (ký tự). Prompt ngắn → skip để
// tránh overhead mạng + latency (sidecar cần load model + inference).
const COMPRESS_THRESHOLD = Number(process.env.LLMLINGUA_COMPRESS_THRESHOLD) || 5000;

// Tỷ lệ nén mặc định: 0.5 = giữ ~50% token, nén ~50%.
// 0.0 = không nén, 1.0 = nén tối đa (rủi ro mất thông tin).
const DEFAULT_RATE = Number(process.env.LLMLINGUA_COMPRESS_RATE) || 0.5;

// Timeout gọi sidecar (ms). LLMLingua inference trên CPU khá chậm
// (DistilBERT nhỏ, nhưng vẫn ~1-3s mỗi lần).
const COMPRESS_TIMEOUT = Number(process.env.LLMLINGUA_COMPRESS_TIMEOUT) || 10_000;

interface CompressResult {
  compressed: string;
  original_length: number;
  compressed_length: number;
  ratio: number;
}

/** Nén prompt text qua LLMLingua sidecar.
 *  - text quá ngắn (< threshold) → trả nguyên (skip).
 *  - sidecar down / timeout → trả nguyên (fail-safe).
 *  - rate=0 → trả nguyên.
 */
export async function compressPrompt(
  text: string,
  opts?: { question?: string; rate?: number },
): Promise<CompressResult> {
  const originalLen = text.length;

  // Prompt ngắn — không đáng nén
  if (originalLen < COMPRESS_THRESHOLD) {
    return {
      compressed: text,
      original_length: originalLen,
      compressed_length: originalLen,
      ratio: 1.0,
    };
  }

  // Tắt nén qua env (rate=0) hoặc caller truyền rate=0
  const rate = opts?.rate ?? DEFAULT_RATE;
  if (rate === 0) {
    return {
      compressed: text,
      original_length: originalLen,
      compressed_length: originalLen,
      ratio: 1.0,
    };
  }

  try {
    const body: Record<string, unknown> = { text, rate };
    if (opts?.question) body.question = opts.question;

    const res = await fetch(`${LLMLINGUA_URL}/compress`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...LLMLINGUA_AUTH,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(COMPRESS_TIMEOUT),
    });

    if (!res.ok) {
      console.warn(`[prompt-compress] sidecar lỗi ${res.status} — skip nén`);
      return {
        compressed: text,
        original_length: originalLen,
        compressed_length: originalLen,
        ratio: 1.0,
      };
    }

    const j = (await res.json()) as CompressResult;
    console.log(
      `[prompt-compress] nén ${originalLen} → ${j.compressed_length} chars (ratio ${(j.ratio * 100).toFixed(0)}%)`,
    );
    return j;
  } catch (e) {
    console.warn("[prompt-compress] sidecar không khả dụng — skip nén:", (e as Error).message);
    return {
      compressed: text,
      original_length: originalLen,
      compressed_length: originalLen,
      ratio: 1.0,
    };
  }
}
