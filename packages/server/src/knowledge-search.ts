/* ==========================================================
   knowledge-search.ts — Tra cứu Knowledge Base bằng ANN cosine.
   Embed câu hỏi → ORDER BY embedding <=> $q (index HNSW) → trả các
   chunk gần nhất kèm thông tin nguồn. Hàm lõi dùng chung cho cả
   route knowledge.search (UI) lẫn tool "knowledge_search" của agent.
   ========================================================== */
import { eq, sql } from "drizzle-orm";
import { knowledgeChunks, knowledgeSources } from "@erp-framework/db";
import type { DB } from "./db";
import { embedTexts } from "./embeddings";

export interface KnowledgeHit {
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  sourceKind: string;
  seq: number;
  content: string;
  /** Độ tương đồng cosine trong [0,1] — càng cao càng gần. */
  score: number;
}

/** Tìm `limit` đoạn gần nghĩa nhất với `query` trong phạm vi công ty. */
export async function knowledgeSearch(
  db: DB, companyId: string, query: string, limit = 5,
): Promise<KnowledgeHit[]> {
  const q = query.trim();
  if (!q) return [];

  const [vec] = await embedTexts(db, companyId, [q]);
  if (!vec) return [];
  // pgvector nhận literal dạng "[0.1,0.2,…]" rồi ép kiểu ::vector.
  const lit = JSON.stringify(vec);

  const rows = await db
    .select({
      chunkId: knowledgeChunks.id,
      sourceId: knowledgeChunks.sourceId,
      seq: knowledgeChunks.seq,
      content: knowledgeChunks.content,
      sourceTitle: knowledgeSources.title,
      sourceKind: knowledgeSources.kind,
      dist: sql<number>`${knowledgeChunks.embedding} <=> ${lit}::vector`,
    })
    .from(knowledgeChunks)
    .innerJoin(knowledgeSources,
      eq(knowledgeChunks.sourceId, knowledgeSources.id))
    .where(eq(knowledgeChunks.companyId, companyId))
    .orderBy(sql`${knowledgeChunks.embedding} <=> ${lit}::vector`)
    .limit(limit);

  return rows.map((r) => ({
    chunkId: r.chunkId,
    sourceId: r.sourceId,
    sourceTitle: r.sourceTitle,
    sourceKind: r.sourceKind,
    seq: r.seq,
    content: r.content,
    score: 1 - Number(r.dist),
  }));
}
