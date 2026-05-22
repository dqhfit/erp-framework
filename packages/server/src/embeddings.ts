/* ==========================================================
   embeddings.ts — Sinh embedding vector cho Knowledge Base.
   Đọc "embedding profile" từ bảng llm_profiles (kind='embedding')
   của công ty; hỗ trợ Ollama (POST /api/embed) và endpoint
   OpenAI-compatible (POST /v1/embeddings, có tham số dimensions).
   Khoá API giải mã qua crypto.ts; chi phí ghi qua activity.ts.
   ========================================================== */
import { and, eq } from "drizzle-orm";
import { llmProfiles } from "@erp-framework/db";
import type { DB } from "./db";
import { decryptSecret } from "./crypto";
import { logActivity } from "./activity";

/** Số chiều vector cố định — xem plan KB. Ollama nomic-embed-text ra
   768 chiều gốc; OpenAI text-embedding-3-small nhận dimensions=768. */
export const EMBED_DIM = 768;

interface EmbedProfile {
  adapter: string;
  model: string;
  endpoint: string | null;
  apiKeyEnc: string | null;
}

async function loadEmbeddingProfile(
  db: DB, companyId: string,
): Promise<EmbedProfile> {
  const [p] = await db.select().from(llmProfiles)
    .where(and(eq(llmProfiles.companyId, companyId),
      eq(llmProfiles.kind, "embedding")))
    .limit(1);
  if (!p) {
    throw new Error(
      "Chưa có embedding profile — vào Cài đặt → Embedding để cấu hình "
      + "(Ollama nomic-embed-text hoặc OpenAI text-embedding-3-small).",
    );
  }
  return {
    adapter: p.adapter, model: p.model,
    endpoint: p.endpoint, apiKeyEnc: p.apiKeyEnc,
  };
}

/* ─── Ollama: POST {endpoint}/api/embed ───────────────────── */
interface OllamaEmbedResp { embeddings?: number[][] }

async function embedOllama(
  p: EmbedProfile, texts: string[],
): Promise<number[][]> {
  const base = (p.endpoint || "http://localhost:11434").replace(/\/$/, "");
  const res = await fetch(base + "/api/embed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: p.model, input: texts }),
  });
  if (!res.ok) {
    throw new Error(`Embedding (Ollama) lỗi ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const j = (await res.json()) as OllamaEmbedResp;
  return j.embeddings ?? [];
}

/* ─── OpenAI-compatible: POST {endpoint}/v1/embeddings ────── */
interface OpenAiEmbedResp {
  data?: Array<{ embedding?: number[]; index?: number }>;
  usage?: { prompt_tokens?: number };
}

async function embedOpenAi(
  p: EmbedProfile, key: string, texts: string[],
): Promise<{ vectors: number[][]; tokens: number }> {
  const base = (p.endpoint || "https://api.openai.com").replace(/\/$/, "");
  const res = await fetch(base + "/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ model: p.model, input: texts, dimensions: EMBED_DIM }),
  });
  if (!res.ok) {
    throw new Error(`Embedding (OpenAI-compat) lỗi ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const j = (await res.json()) as OpenAiEmbedResp;
  // Sắp theo index để khớp thứ tự input.
  const sorted = [...(j.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return {
    vectors: sorted.map((d) => d.embedding ?? []),
    tokens: j.usage?.prompt_tokens ?? 0,
  };
}

/** Sinh embedding cho một loạt văn bản. Trả về mảng vector cùng thứ
   tự với `texts`. Ném lỗi nếu profile thiếu hoặc số chiều sai. */
export async function embedTexts(
  db: DB, companyId: string, texts: string[],
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const p = await loadEmbeddingProfile(db, companyId);

  let vectors: number[][];
  let tokens = 0;
  if (p.adapter === "ollama") {
    vectors = await embedOllama(p, texts);
  } else if (p.adapter === "openai") {
    const key = (p.apiKeyEnc ? decryptSecret(p.apiKeyEnc) : "")
      || process.env.OPENAI_API_KEY || "";
    if (!key) throw new Error("Embedding profile (OpenAI) thiếu API key.");
    const r = await embedOpenAi(p, key, texts);
    vectors = r.vectors;
    tokens = r.tokens;
  } else {
    throw new Error(
      `Adapter "${p.adapter}" không hỗ trợ embedding — dùng "ollama" hoặc "openai".`,
    );
  }

  if (vectors.length !== texts.length) {
    throw new Error(
      `Embedding trả ${vectors.length} vector cho ${texts.length} đoạn — không khớp.`,
    );
  }
  for (const v of vectors) {
    if (v.length !== EMBED_DIM) {
      throw new Error(
        `Embedding ${v.length} chiều, cần ${EMBED_DIM} — đổi model hoặc đặt `
        + `dimensions=${EMBED_DIM}.`,
      );
    }
  }

  await logActivity(db, {
    companyId,
    kind: "embedding",
    objectType: "knowledge",
    model: p.model,
    tokensInput: tokens || undefined,
    detail: `Sinh embedding ${texts.length} đoạn (${p.model}).`,
  });
  return vectors;
}
