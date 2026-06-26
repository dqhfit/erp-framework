/* ==========================================================
   knowledge-graph.ts — Tang knowledge-graph MONG cho RAG.

   Thay cho graphrag/cognee (lech stack Python, da tenant kem, can Neo4j) —
   dung 1 bang Postgres `knowledge_edges` (bo ba subject-predicate-object,
   migration 0090) ngay trong DB hien co, ton trong company_id + ACL.

   Hai nua:
   - extractRelations: luc INGEST (opt-in meta.extractGraph) — callLlmJson
     trich bo ba tu cac doan, luu kem chunk_id provenance. Fail-safe: null
     → khong ghi edge, KB van ready.
   - expandGraph: luc RETRIEVE (che do Deep) — tu cac hit ban dau di 1-hop
     theo thuc the chung, keo cac doan KHAC (ke ca NGUON khac) noi qua thuc
     the do. KHAC expandNeighbors (cung nguon, da qua ACL): doan keo ve co
     the thuoc nguon khac → BAT BUOC ap lai knowledgeAccessibleSql + sourceIds.

   Triet ly: rE-mac-dinh (graph OFF mac dinh), fail-safe phan tang (loi → []),
   multi-tenant fail-closed. Xem docs/AGENTIC-RAG-DESIGN-2026-05-31.md.
   ========================================================== */
import { knowledgeEdges } from "@erp-framework/db";
import { type SQL, sql } from "drizzle-orm";
import type { DB } from "./db";
import { type KnowledgeAcl, knowledgeAccessibleSql } from "./knowledge-acl";
import type { KnowledgeHit } from "./knowledge-search";
import { callLlmJson } from "./llm-json";

const RELATION_EXTRACT_SYSTEM =
  "Ban la bo TRICH QUAN HE (knowledge graph) cho tai lieu doanh nghiep. Cho " +
  "danh sach DOAN (moi doan co chi so i). Voi moi doan, trich cac BO BA quan " +
  "he RO RANG dang (chu the, quan he, doi tuong): chu the/doi tuong la TEN " +
  "THUC THE cu the (nguoi, to chuc, san pham, ma, khai niem), quan he la cum " +
  "dong tu ngan. CHI trich quan he NEU RO trong doan, KHONG suy dien/bia. " +
  "Bo qua doan khong co quan he ro. Toi da ~3 bo ba/doan. Tra JSON: " +
  '{"triples":[{"i":<chi so doan>,"s":"chu the","p":"quan he","o":"doi tuong"}]}.';

/** So doan toi da trich quan he cho 1 nguon — chan chi phi LLM (mirror
 *  MAX_CHUNKS o run-kb-ingest). Nguon lon hon chi trich phan dau. */
const MAX_GRAPH_CHUNKS = 200;
/** So doan gui moi loi goi LLM (gop nhieu doan → it loi goi hon). */
const EXTRACT_BATCH = 8;
/** Cat noi dung doan khi gui cho bo trich — du ngu canh, tiet kiem token. */
const EXTRACT_CHARS = 600;

interface RawTriples {
  triples?: Array<{ i?: unknown; s?: unknown; p?: unknown; o?: unknown }>;
}

/** Chuan hoa ten thuc the de KHOP: ha chu thuong, bo dau tieng Viet (NFD +
 *  strip combining), d→d, doi ky tu khong phai chu-so thanh khoang trang,
 *  gop khoang trang. Ham THUAN (unit-test). Rong → "". */
export function normalizeEntity(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[đĐ]/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

interface EdgeRow {
  companyId: string;
  sourceId: string;
  chunkId: string;
  subject: string;
  predicate: string;
  object: string;
  subjectRaw: string;
  objectRaw: string;
}

/** Trich bo ba quan he tu cac doan vua nap, luu vao knowledge_edges (kem
 *  chunk_id provenance). Goi callLlmJson theo lo (fail-safe: lo null → bo
 *  qua). Tra so edge da ghi. KHONG nem — moi loi nuot ve 0 (caller ingest
 *  da try/catch nhung day la lop bao ve thu hai: loi graph khong vo nap KB). */
export async function extractRelations(
  db: DB,
  companyId: string,
  sourceId: string,
  chunks: Array<{ id: string; content: string }>,
  userId?: string,
): Promise<number> {
  const used = chunks.slice(0, MAX_GRAPH_CHUNKS);
  if (!used.length) return 0;
  const rows: EdgeRow[] = [];
  try {
    for (let i = 0; i < used.length; i += EXTRACT_BATCH) {
      const batch = used.slice(i, i + EXTRACT_BATCH);
      const payload = batch
        .map((c, j) => `[${j}] ${c.content.slice(0, EXTRACT_CHARS)}`)
        .join("\n\n");
      const r = await callLlmJson<RawTriples>(db, companyId, {
        system: RELATION_EXTRACT_SYSTEM,
        user: payload,
        maxTokens: 800,
        userId,
      });
      for (const t of r?.triples ?? []) {
        const idx = typeof t.i === "number" ? t.i : Number(t.i);
        const chunk = Number.isInteger(idx) ? batch[idx] : undefined;
        if (!chunk) continue;
        const sRaw = typeof t.s === "string" ? t.s.trim() : "";
        const oRaw = typeof t.o === "string" ? t.o.trim() : "";
        const pRaw = typeof t.p === "string" ? t.p.trim() : "";
        const subject = normalizeEntity(sRaw);
        const object = normalizeEntity(oRaw);
        if (!subject || !object) continue;
        rows.push({
          companyId,
          sourceId,
          chunkId: chunk.id,
          subject,
          predicate: pRaw.toLowerCase().slice(0, 200) || "lien quan",
          object,
          subjectRaw: sRaw.slice(0, 500),
          objectRaw: oRaw.slice(0, 500),
        });
      }
    }
    if (!rows.length) return 0;
    await db.insert(knowledgeEdges).values(rows);
    return rows.length;
  } catch (e) {
    console.warn("[knowledge-graph] trich quan he loi:", (e as Error).message);
    return 0;
  }
}

/** Xoa toan bo edge cua mot nguon — goi truoc khi re-ingest trich lai (chunk
 *  bi xoa+chen lai voi id moi → edge cu da cascade theo chunk, day la don
 *  them cho chac va cho truong hop tat extractGraph). */
export async function deleteEdgesForSource(db: DB, sourceId: string): Promise<void> {
  await db.delete(knowledgeEdges).where(sql`source_id = ${sourceId}::uuid`);
}

export interface ExpandGraphOpts {
  /** Quyen user/nhom — BAT BUOC ap lai vi doan keo ve co the thuoc NGUON khac
   *  chua qua ACL (khac expandNeighbors cung nguon). undefined = admin/he thong. */
  acl?: KnowledgeAcl;
  /** Pham vi nguon cau hinh cho agent (#3b) — gioi han chunk keo ve. */
  sourceIds?: string[];
  /** So doan toi da keo ve (mac dinh 8). */
  limit?: number;
}

interface ExpandRow {
  chunk_id: string;
  source_id: string;
  seq: number | string;
  content: string;
  source_title: string;
  source_kind: string;
}

/** UUID v4/v7 dang chuan — loc bo chunkId gia (live:<id>, web:N) khong cast
 *  duoc sang ::uuid. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mo rong theo do thi: tu cac hit → thuc the chung → doan KHAC (ke ca nguon
 *  khac) noi qua thuc the do. Tra cac KnowledgeHit MOI (score=0; bo re-rank/
 *  merge o caller lo xep hang). BAO MAT: ap knowledgeAccessibleSql(acl) +
 *  sourceIds vi doan keo ve co the thuoc nguon chua qua ACL. Fail-safe: loi
 *  DB / khong co edge → tra [] (giu nguyen hits). */
export async function expandGraph(
  db: DB,
  companyId: string,
  hits: KnowledgeHit[],
  opts: ExpandGraphOpts = {},
): Promise<KnowledgeHit[]> {
  const cap = Math.min(20, Math.max(1, opts.limit ?? 8));
  // Chi dung chunkId la UUID that (bo live:/web: khong phai chunk DB).
  const hitIds = [...new Set(hits.map((h) => h.chunkId).filter((id) => UUID_RE.test(id)))];
  if (!hitIds.length) return [];
  const hitIdSql = sql.join(
    hitIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  // Loc nguon theo ACL + sourceIds — mirror knowledge-search.ts: subquery tren
  // knowledge_sources KHONG alias (knowledgeAccessibleSql tham chieu ten that).
  const srcConds: SQL[] = [];
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
    ? sql` AND c.source_id IN (SELECT id FROM knowledge_sources WHERE company_id = ${companyId}::uuid AND ${sql.join(srcConds, sql` AND `)})`
    : sql``;

  try {
    const rows = (await db.execute(sql`
      WITH seed AS (
        SELECT subject AS ent FROM knowledge_edges
        WHERE company_id = ${companyId}::uuid AND chunk_id IN (${hitIdSql})
        UNION
        SELECT object AS ent FROM knowledge_edges
        WHERE company_id = ${companyId}::uuid AND chunk_id IN (${hitIdSql})
      )
      SELECT DISTINCT c.id AS chunk_id, c.source_id, c.seq, c.content,
             s.title AS source_title, s.kind AS source_kind
      FROM knowledge_edges e
      JOIN knowledge_chunks c ON c.id = e.chunk_id
      JOIN knowledge_sources s ON s.id = c.source_id
      WHERE e.company_id = ${companyId}::uuid
        AND e.chunk_id IS NOT NULL
        AND (e.subject IN (SELECT ent FROM seed) OR e.object IN (SELECT ent FROM seed))
        AND c.id NOT IN (${hitIdSql})${srcCond}
      LIMIT ${cap}
    `)) as unknown as ExpandRow[];
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      chunkId: r.chunk_id,
      sourceId: r.source_id,
      sourceTitle: r.source_title,
      sourceKind: r.source_kind,
      seq: Number(r.seq),
      content: r.content,
      score: 0,
    }));
  } catch (e) {
    console.warn("[knowledge-graph] expand do thi loi:", (e as Error).message);
    return [];
  }
}
