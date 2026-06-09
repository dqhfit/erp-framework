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
import { type SQL, sql } from "drizzle-orm";
import type { DB } from "./db";
import { embedTexts } from "./embeddings";
import { type KnowledgeAcl, knowledgeAccessibleSql } from "./knowledge-acl";

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
  /** Giới hạn theo quyền user/nhóm (Step 1). undefined = không lọc (admin
     hoặc ngữ cảnh hệ thống). Agent-scope xử lý riêng (#3b). */
  acl?: KnowledgeAcl;
  /** Giới hạn theo tập nguồn cấu hình cho agent (#3b). undefined/rỗng =
     không giới hạn. Khác acl (user/nhóm) — đây là phạm vi tri thức riêng
     của agent, độc lập với người đang chat. */
  sourceIds?: string[];
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

/* ── On-demand: nguồn entity "live" (không embed) ─────────────
   Thay vì nhúng toàn bộ entity vào KB (chậm/treo với dữ liệu lớn — xem
   feedback Tri thức), nguồn live được TRUY VẤN TRỰC TIẾP lúc search bằng
   FTS trên entity_records.search_tsv. Trả mỗi bản ghi khớp thành 1 hit. */
type LiveSrcRow = { id: string; title: string; entity_id: string | null };
type LiveRecRow = { id: string; data: Record<string, unknown> | null; rank: number | string };

async function searchLiveEntities(
  db: DB,
  companyId: string,
  q: string,
  opts: KnowledgeSearchOpts,
  limit: number,
): Promise<KnowledgeHit[]> {
  // Chỉ áp khi không lọc kind, hoặc lọc đúng "entity".
  if (opts.sourceKind && opts.sourceKind !== "entity") return [];

  const conds: SQL[] = [
    sql`company_id = ${companyId}::uuid`,
    sql`kind = 'entity'`,
    sql`meta->>'mode' = 'live'`,
  ];
  if (opts.acl) conds.push(knowledgeAccessibleSql(opts.acl));
  if (opts.sourceIds && opts.sourceIds.length > 0) {
    conds.push(
      sql`id IN (${sql.join(
        opts.sourceIds.map((sid) => sql`${sid}::uuid`),
        sql`, `,
      )})`,
    );
  }
  const sources = (await db.execute(sql`
    SELECT id, title, meta->>'entityId' AS entity_id
    FROM knowledge_sources
    WHERE ${sql.join(conds, sql` AND `)}
  `)) as unknown as LiveSrcRow[];
  const srcList = (Array.isArray(sources) ? sources : []).filter((s) => s.entity_id);
  if (srcList.length === 0) return [];

  // Nhãn field để render bản ghi → "Nhãn: giá trị".
  const entityIds = [...new Set(srcList.map((s) => s.entity_id as string))];
  const ents = (await db.execute(sql`
    SELECT id, fields FROM entities
    WHERE company_id = ${companyId}::uuid
      AND id IN (${sql.join(
        entityIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
  `)) as unknown as Array<{ id: string; fields: Array<{ name: string; label?: string }> | null }>;
  const fieldsById = new Map(ents.map((e) => [e.id, e.fields ?? []]));

  const perSource = Math.min(limit, 5);
  const hits: KnowledgeHit[] = [];
  for (const s of srcList) {
    const entityId = s.entity_id as string;
    const recs = (await db.execute(sql`
      SELECT id, data, ts_rank(search_tsv, websearch_to_tsquery('simple', ${q})) AS rank
      FROM entity_records
      WHERE entity_id = ${entityId}::uuid
        AND company_id = ${companyId}::uuid
        AND deleted_at IS NULL
        AND search_tsv @@ websearch_to_tsquery('simple', ${q})
      ORDER BY rank DESC
      LIMIT ${perSource}
    `)) as unknown as LiveRecRow[];
    const fields = fieldsById.get(entityId) ?? [];
    for (const r of Array.isArray(recs) ? recs : []) {
      const data = (r.data ?? {}) as Record<string, unknown>;
      const lines: string[] = [];
      for (const f of fields) {
        const v = data[f.name];
        if (v === undefined || v === null || v === "") continue;
        lines.push(
          `${f.label || f.name}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`,
        );
      }
      if (lines.length === 0) continue;
      hits.push({
        chunkId: `live:${r.id}`,
        sourceId: s.id,
        sourceTitle: s.title,
        sourceKind: "entity",
        seq: 0,
        content: lines.join("\n"),
        score: Number(r.rank) || 0,
      });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

/** Gộp hit từ chunk (embed) + hit live (entity on-demand). Dành ~1/3 số ô
 *  cho live khi có (để dữ liệu trực tiếp luôn nổi lên dù thang điểm khác),
 *  phần còn lại lấp bằng chunk, dư thì thêm live. */
function mergeHits(
  chunkHits: KnowledgeHit[],
  liveHits: KnowledgeHit[],
  limit: number,
): KnowledgeHit[] {
  if (liveHits.length === 0) return chunkHits.slice(0, limit);
  const liveSlots = Math.min(liveHits.length, Math.max(1, Math.floor(limit / 3)));
  const picked: KnowledgeHit[] = [...liveHits.slice(0, liveSlots)];
  for (const h of chunkHits) {
    if (picked.length >= limit) break;
    picked.push(h);
  }
  for (const h of liveHits.slice(liveSlots)) {
    if (picked.length >= limit) break;
    picked.push(h);
  }
  return picked.slice(0, limit);
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

  // Lọc ứng viên theo loại nguồn (sourceKind) + quyền truy cập (acl) — gộp
  // vào MỘT subquery source_id IN (...), đặt TRONG nhánh chọn ứng viên để
  // không bị co tập kết quả sau khi đã rank. source_id không nhập nhằng
  // (chỉ knowledge_chunks có cột này). Không điều kiện nào → fragment trống.
  const srcConds: SQL[] = [];
  if (opts.sourceKind) srcConds.push(sql`kind = ${opts.sourceKind}`);
  if (opts.acl) srcConds.push(knowledgeAccessibleSql(opts.acl));
  if (opts.sourceIds && opts.sourceIds.length > 0) {
    srcConds.push(
      sql`id IN (${sql.join(
        opts.sourceIds.map((sid) => sql`${sid}::uuid`),
        sql`, `,
      )})`,
    );
  }
  const srcCond = srcConds.length
    ? sql` AND source_id IN (SELECT id FROM knowledge_sources WHERE company_id = ${companyId}::uuid AND ${sql.join(srcConds, sql` AND `)})`
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
        AND c.search_tsv @@ websearch_to_tsquery('simple', ${q})${srcCond}
      ORDER BY sim DESC
      LIMIT ${limit}
    `)) as unknown as Row[];
    const chunkHits = toHits(rows);
    return mergeHits(chunkHits, await searchLiveEntities(db, companyId, q, opts, limit), limit);
  }

  // ── Hybrid: vec CTE (cosine) + fts CTE, hoà bằng RRF. ──
  // sim (cosine) tính lại ở SELECT ngoài cho đúng tập trả về nhỏ (rẻ),
  // dùng cho hiển thị + ngưỡng MIN_SCORE; thứ tự lấy theo rrf.
  const rows = (await db.execute(sql`
    WITH vec AS (
      SELECT id,
             row_number() OVER (ORDER BY embedding <=> ${lit}::vector) AS rnk
      FROM knowledge_chunks
      WHERE company_id = ${companyId}::uuid AND embedding IS NOT NULL${srcCond}
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
        AND c.search_tsv @@ websearch_to_tsquery('simple', ${q})${srcCond}
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

  const chunkHits = toHits(rows);
  return mergeHits(chunkHits, await searchLiveEntities(db, companyId, q, opts, limit), limit);
}
