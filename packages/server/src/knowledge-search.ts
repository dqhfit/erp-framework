/* ==========================================================
   knowledge-search.ts — Tra cứu Knowledge Base bằng HYBRID retrieval.
   Gộp 2 tín hiệu rồi hoà bằng RRF (Reciprocal Rank Fusion):
     1. ANN cosine trên cột vector (HNSW, migration 0007) — bắt ngữ nghĩa.
     2. FTS keyword trên search_tsv (GIN, migration 0062) — bắt từ khoá,
        mã, tên riêng mà embedding hay bỏ sót.
   RRF chỉ dùng THỨ HẠNG của mỗi danh sách nên không cần chuẩn hoá hai
   thang điểm khác bản chất (cosine vs ts_rank).

   Hàm lõi dùng chung cho route knowledge.search (UI) lẫn tool
   "knowledge_search" của agent. Fail-safe theo CLAUDE.md: nếu embedding
   lỗi → tự lùi về FTS-only thay vì vỡ, đảm bảo vẫn có kết quả keyword.
   ========================================================== */
import { sql } from "drizzle-orm";
import type { DB } from "./db";
import { embedTexts } from "./embeddings";

export interface KnowledgeHit {
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  sourceKind: string;
  seq: number;
  content: string;
  /** Độ tương đồng cosine trong [0,1] — càng cao càng gần. Ở chế độ lùi
     FTS-only (embedding lỗi) đây là ts_rank, không phải cosine. */
  score: number;
}

/** Ngưỡng cosine tối thiểu — bỏ đoạn quá ít liên quan để tránh nhiễu.
   CHỈ áp cho hit thuần-vector; hit khớp FTS luôn giữ (đã liên quan theo
   từ khoá), đây chính là phần recall mà hybrid bổ sung. */
const MIN_SCORE = 0.2;

/** Hằng số RRF — k càng lớn càng san phẳng ảnh hưởng của thứ hạng cao.
   60 là giá trị chuẩn trong tài liệu RRF gốc. */
const RRF_K = 60;

export interface KnowledgeSearchOpts {
  /** Số kết quả tối đa (mặc định 5, clamp 1..20). */
  limit?: number;
  /** Lọc theo loại nguồn (knowledge_sources.kind). Bỏ trống = mọi loại. */
  sourceKind?: "file" | "entity" | "text";
}

type Row = {
  chunk_id: string;
  source_id: string;
  seq: number;
  content: string;
  source_title: string;
  source_kind: string;
  sim: number | string | null;
  fts_hit: boolean;
};

function toHits(rows: Row[]): KnowledgeHit[] {
  return (
    rows
      .map((r) => ({
        chunkId: r.chunk_id,
        sourceId: r.source_id,
        sourceTitle: r.source_title,
        sourceKind: r.source_kind,
        seq: Number(r.seq),
        content: r.content,
        score: r.sim == null ? 0 : Number(r.sim),
        ftsHit: r.fts_hit === true,
      }))
      // Giữ nếu khớp FTS, hoặc cosine đủ cao.
      .filter((h) => h.ftsHit || h.score >= MIN_SCORE)
      .map(({ ftsHit: _ftsHit, ...h }) => h)
  );
}

/** Tìm các đoạn liên quan nhất với `query` trong phạm vi công ty. */
export async function knowledgeSearch(
  db: DB,
  companyId: string,
  query: string,
  opts: KnowledgeSearchOpts = {},
): Promise<KnowledgeHit[]> {
  const q = query.trim();
  if (!q) return [];

  const limit = Math.min(20, Math.max(1, opts.limit ?? 5));
  // Vòng nến rộng để hai nhánh có đủ ứng viên trước khi hoà rank.
  const cand = Math.max(20, limit * 4);

  // Lọc theo loại nguồn — đặt TRONG nhánh chọn ứng viên (CTE/WHERE) để
  // không bị co tập kết quả sau khi đã rank. source_id không nhập nhằng
  // (chỉ knowledge_chunks có cột này). Rỗng → fragment trống.
  const kindCond = opts.sourceKind
    ? sql` AND source_id IN (SELECT id FROM knowledge_sources WHERE company_id = ${companyId}::uuid AND kind = ${opts.sourceKind})`
    : sql``;

  // Embed câu hỏi — fail-safe: lỗi (profile thiếu / sidecar down) thì
  // không vỡ, lùi về FTS-only bên dưới.
  let lit: string | null = null;
  try {
    const [vec] = await embedTexts(db, companyId, [q]);
    if (vec) lit = JSON.stringify(vec);
  } catch (e) {
    console.warn("[knowledge] embed lỗi, lùi FTS-only:", (e as Error).message);
  }

  // ── FTS-only: không có vector → chỉ keyword, score = ts_rank. ──
  if (!lit) {
    const rows = (await db.execute(sql`
      SELECT c.id AS chunk_id, c.source_id, c.seq, c.content,
             s.title AS source_title, s.kind AS source_kind,
             ts_rank(c.search_tsv, websearch_to_tsquery('simple', ${q})) AS sim,
             true AS fts_hit
      FROM knowledge_chunks c
      JOIN knowledge_sources s ON s.id = c.source_id
      WHERE c.company_id = ${companyId}::uuid
        AND c.search_tsv @@ websearch_to_tsquery('simple', ${q})${kindCond}
      ORDER BY sim DESC
      LIMIT ${limit}
    `)) as unknown as Row[];
    return toHits(rows);
  }

  // ── Hybrid: vec CTE (cosine) + fts CTE, hoà bằng RRF. ──
  // sim (cosine) tính lại ở SELECT ngoài cho đúng tập trả về nhỏ (rẻ),
  // dùng cho hiển thị + ngưỡng MIN_SCORE; thứ tự lấy theo rrf.
  const rows = (await db.execute(sql`
    WITH vec AS (
      SELECT id,
             row_number() OVER (ORDER BY embedding <=> ${lit}::vector) AS rnk
      FROM knowledge_chunks
      WHERE company_id = ${companyId}::uuid AND embedding IS NOT NULL${kindCond}
      ORDER BY embedding <=> ${lit}::vector
      LIMIT ${cand}
    ),
    fts AS (
      SELECT c.id,
             row_number() OVER (
               ORDER BY ts_rank(c.search_tsv, websearch_to_tsquery('simple', ${q})) DESC
             ) AS rnk
      FROM knowledge_chunks c
      WHERE c.company_id = ${companyId}::uuid
        AND c.search_tsv @@ websearch_to_tsquery('simple', ${q})${kindCond}
      ORDER BY ts_rank(c.search_tsv, websearch_to_tsquery('simple', ${q})) DESC
      LIMIT ${cand}
    ),
    ids AS (SELECT id FROM vec UNION SELECT id FROM fts)
    SELECT c.id AS chunk_id, c.source_id, c.seq, c.content,
           s.title AS source_title, s.kind AS source_kind,
           (1 - (c.embedding <=> ${lit}::vector)) AS sim,
           (f.id IS NOT NULL) AS fts_hit,
           COALESCE(1.0 / (${RRF_K} + v.rnk), 0)
             + COALESCE(1.0 / (${RRF_K} + f.rnk), 0) AS rrf
    FROM ids
    JOIN knowledge_chunks c ON c.id = ids.id
    JOIN knowledge_sources s ON s.id = c.source_id
    LEFT JOIN vec v ON v.id = ids.id
    LEFT JOIN fts f ON f.id = ids.id
    ORDER BY rrf DESC
    LIMIT ${limit}
  `)) as unknown as Row[];

  return toHits(rows);
}
