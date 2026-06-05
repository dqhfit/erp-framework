/* ==========================================================
   knowledge-agentic.ts — Lõi Agentic RAG kiểu "server-orchestrated".
   Agency nằm trong code server (KHÔNG giao LLM tự lái tool) để chạy
   tin cậy trên claude-cli (bridge): mỗi bước suy luận là 1 lời gọi
   callLlmJson (prompt→JSON), né emulation tool dễ vỡ.
   Xem docs/AGENTIC-RAG-DESIGN-2026-05-31.md §1.5.

   P1 (file này): planQueries (rewrite) + agenticRetrieve (plan→search
   song song→gộp/khử trùng). P2 sẽ chèn bước grade/correct vào
   agenticRetrieve (đã chừa hook). Toàn bộ fail-safe.
   ========================================================== */
import { type SQL, sql } from "drizzle-orm";
import type { DB } from "./db";
import { type KnowledgeHit, type KnowledgeSearchOpts, knowledgeSearch } from "./knowledge-search";
import { callLlmJson } from "./llm-json";

const QUERY_REWRITE_SYSTEM =
  "Bạn là bộ viết lại truy vấn cho hệ thống tra cứu tài liệu nội bộ doanh " +
  "nghiệp. Nhiệm vụ: từ câu hỏi của người dùng, sinh 1–3 truy vấn tìm kiếm " +
  "NGẮN, CỤ THỂ, mỗi truy vấn nhắm 1 khía cạnh. Mở rộng viết tắt/mã nếu rõ. " +
  "KHÔNG bịa thông tin. Nếu câu hỏi đã đủ cụ thể, trả đúng 1 truy vấn là " +
  'chính nó. Trả JSON: {"queries": ["..."], "reason": "ngắn gọn"}.';

const GRADE_SYSTEM =
  "Bạn là bộ chấm độ liên quan cho hệ thống RAG. Cho CÂU HỎI và danh sách " +
  "ĐOẠN (mỗi đoạn có id). Quyết định: các đoạn có đủ thông tin trả lời câu " +
  "hỏi không? relevant=true nếu có ÍT NHẤT 1 đoạn trực tiếp liên quan — liệt " +
  "kê usableChunkIds (chỉ id thực sự dùng được). relevant=false nếu lạc đề — " +
  "đề xuất suggestedQuery viết lại tốt hơn. CHỈ căn cứ nội dung đoạn, KHÔNG " +
  'dùng kiến thức ngoài. Trả JSON: {"relevant": bool, "usableChunkIds": ' +
  '["..."], "suggestedQuery": "..."}.';

/** Ngưỡng cosine "đủ mạnh" — top-1 vượt ngưỡng này thì bỏ qua grading
   (tiết kiệm 1 lời gọi LLM). Dưới ngưỡng = mơ hồ → mới chấm. */
const STRONG_SCORE = 0.55;

/** Cắt nội dung đoạn khi gửi cho grader — đủ ngữ cảnh, tiết kiệm token. */
const GRADE_CHUNK_CHARS = 400;

/** Cửa sổ lân cận seq±N gộp quanh mỗi hit — graph expansion trên đồ thị
   kề-đoạn (cùng nguồn). 1 = lấy thêm đoạn ngay trước + ngay sau. */
const NEIGHBOR_WINDOW = 1;
/** Ngân sách ký tự ngữ cảnh sau nén — chặn phình context gửi cho LLM. */
const MAX_CONTEXT_CHARS = 6000;

const RERANK_SYSTEM =
  "Bạn là bộ xếp hạng lại (re-rank) cho RAG. Cho CÂU HỎI và danh sách ĐOẠN " +
  "(mỗi đoạn có id). Sắp xếp id theo độ liên quan GIẢM DẦN với câu hỏi; loại " +
  'bỏ id lạc đề. Chỉ căn cứ nội dung đoạn. Trả JSON: {"order": ["id1", ...]}.';

interface QueryPlan {
  queries?: string[];
  reason?: string;
}

interface GradeResult {
  relevant?: boolean;
  usableChunkIds?: string[];
  suggestedQuery?: string;
}

/** Viết lại câu hỏi user → 1-3 truy vấn con cụ thể. Tốn 1 lời gọi LLM
 *  (rẻ, maxTokens nhỏ). Fail-safe: lỗi/null/rỗng → trả [câu hỏi gốc]. */
export async function planQueries(
  db: DB,
  companyId: string,
  userQuery: string,
  userId?: string,
): Promise<string[]> {
  const q = userQuery.trim();
  if (!q) return [];
  const plan = await callLlmJson<QueryPlan>(db, companyId, {
    system: QUERY_REWRITE_SYSTEM,
    user: q,
    maxTokens: 256,
    userId,
  });
  const qs = (plan?.queries ?? [])
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, 3);
  return qs.length ? qs : [q];
}

/** Gộp nhiều danh sách hit, khử trùng theo chunkId (giữ score cao nhất),
 *  sắp giảm dần theo score, cắt top `limit`. Hàm thuần — dễ unit test. */
export function mergeHits(lists: KnowledgeHit[][], limit: number): KnowledgeHit[] {
  const best = new Map<string, KnowledgeHit>();
  for (const list of lists) {
    for (const h of list) {
      const prev = best.get(h.chunkId);
      if (!prev || h.score > prev.score) best.set(h.chunkId, h);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Lọc hits theo danh sách chunkId grader cho là dùng được. Hàm thuần.
 *  Nếu lọc ra rỗng (grader trả id lạ) → giữ nguyên hits (an toàn recall). */
export function filterUsable(hits: KnowledgeHit[], usableChunkIds?: string[]): KnowledgeHit[] {
  if (!usableChunkIds?.length) return hits;
  const keep = new Set(usableChunkIds);
  const filtered = hits.filter((h) => keep.has(h.chunkId));
  return filtered.length ? filtered : hits;
}

/** Graph expansion: với mỗi hit, lấy thêm các đoạn lân cận (seq±window)
 *  CÙNG NGUỒN để câu trả lời không bị cắt ngang ranh giới chunk. Đoạn lân
 *  cận gán score=0 (chưa khớp trực tiếp) — bước nén sẽ kế thừa score của
 *  run. An toàn quyền: lân cận thuộc cùng nguồn đã lọt acl/sourceIds ở bước
 *  search nên không cần lọc lại. Fail-safe: lỗi DB → trả nguyên hits. */
export async function expandNeighbors(
  db: DB,
  companyId: string,
  hits: KnowledgeHit[],
  window = NEIGHBOR_WINDOW,
): Promise<KnowledgeHit[]> {
  if (hits.length === 0 || window <= 0) return hits;
  const have = new Set(hits.map((h) => `${h.sourceId}:${h.seq}`));
  const wantBySource = new Map<string, Set<number>>();
  for (const h of hits) {
    const set = wantBySource.get(h.sourceId) ?? new Set<number>();
    for (let d = -window; d <= window; d++) {
      const s = h.seq + d;
      if (s >= 0 && !have.has(`${h.sourceId}:${s}`)) set.add(s);
    }
    if (set.size) wantBySource.set(h.sourceId, set);
  }
  const conds: SQL[] = [];
  for (const [sid, seqs] of wantBySource) {
    if (!seqs.size) continue;
    conds.push(
      sql`(c.source_id = ${sid}::uuid AND c.seq IN (${sql.join(
        [...seqs].map((n) => sql`${n}`),
        sql`, `,
      )}))`,
    );
  }
  if (!conds.length) return hits;
  try {
    const rows = (await db.execute(sql`
      SELECT c.id AS chunk_id, c.source_id, c.seq, c.content,
             s.title AS source_title, s.kind AS source_kind
      FROM knowledge_chunks c
      JOIN knowledge_sources s ON s.id = c.source_id
      WHERE c.company_id = ${companyId}::uuid AND (${sql.join(conds, sql` OR `)})
    `)) as unknown as Array<{
      chunk_id: string;
      source_id: string;
      seq: number;
      content: string;
      source_title: string;
      source_kind: string;
    }>;
    const neighbors: KnowledgeHit[] = rows.map((r) => ({
      chunkId: r.chunk_id,
      sourceId: r.source_id,
      sourceTitle: r.source_title,
      sourceKind: r.source_kind,
      seq: Number(r.seq),
      content: r.content,
      score: 0,
    }));
    return [...hits, ...neighbors];
  } catch (e) {
    console.warn("[knowledge] expand neighbor lỗi:", (e as Error).message);
    return hits;
  }
}

/** Nén ngữ cảnh (hàm thuần): khử trùng chunkId → gộp các đoạn seq LIÊN TIẾP
 *  cùng nguồn thành một khối (score = max của run) → sắp theo score giảm dần
 *  → cắt theo ngân sách ký tự. Giảm phân mảnh + chặn phình context. */
export function mergeContiguous(
  hits: KnowledgeHit[],
  maxChars = MAX_CONTEXT_CHARS,
): KnowledgeHit[] {
  if (hits.length <= 1) return hits;
  const byId = new Map<string, KnowledgeHit>();
  for (const h of hits) {
    const prev = byId.get(h.chunkId);
    if (!prev || h.score > prev.score) byId.set(h.chunkId, h);
  }
  const bySource = new Map<string, KnowledgeHit[]>();
  for (const h of byId.values()) {
    const arr = bySource.get(h.sourceId) ?? [];
    arr.push(h);
    bySource.set(h.sourceId, arr);
  }
  const blocks: KnowledgeHit[] = [];
  for (const arr of bySource.values()) {
    arr.sort((a, b) => a.seq - b.seq);
    let cur: KnowledgeHit | null = null;
    let lastSeq = Number.NEGATIVE_INFINITY;
    for (const h of arr) {
      if (cur && h.seq === lastSeq + 1) {
        cur.content += `\n${h.content}`;
        cur.score = Math.max(cur.score, h.score);
      } else {
        if (cur) blocks.push(cur);
        cur = { ...h };
      }
      lastSeq = h.seq;
    }
    if (cur) blocks.push(cur);
  }
  blocks.sort((a, b) => b.score - a.score);
  const out: KnowledgeHit[] = [];
  let total = 0;
  for (const b of blocks) {
    // Luôn giữ khối đầu (liên quan nhất) dù dài; khối sau mới chịu ngân sách.
    if (out.length > 0 && total + b.content.length > maxChars) continue;
    out.push(b);
    total += b.content.length;
  }
  return out;
}

interface RerankResult {
  order?: string[];
}

/** Re-rank bằng LLM (chế độ Deep): xếp lại hits theo độ liên quan với câu
 *  hỏi. 1 lời gọi callLlmJson. Fail-safe: null/rỗng → giữ nguyên thứ tự;
 *  id model bỏ sót được nối ở cuối theo thứ tự cũ (không mất recall). */
export async function rerankHits(
  db: DB,
  companyId: string,
  query: string,
  hits: KnowledgeHit[],
  userId?: string,
): Promise<KnowledgeHit[]> {
  if (hits.length <= 1) return hits;
  const payload =
    `Câu hỏi: ${query}\n\nCác đoạn:\n` +
    hits.map((h) => `[id=${h.chunkId}] ${h.content.slice(0, GRADE_CHUNK_CHARS)}`).join("\n\n");
  const r = await callLlmJson<RerankResult>(db, companyId, {
    system: RERANK_SYSTEM,
    user: payload,
    maxTokens: 512,
    userId,
  });
  const order = r?.order;
  if (!order?.length) return hits;
  const byId = new Map(hits.map((h) => [h.chunkId, h]));
  const ranked: KnowledgeHit[] = [];
  for (const id of order) {
    const h = byId.get(id);
    if (h) {
      ranked.push(h);
      byId.delete(id);
    }
  }
  for (const h of hits) if (byId.has(h.chunkId)) ranked.push(h);
  return ranked.length ? ranked : hits;
}

/** Chấm độ liên quan của tập hits với câu hỏi. 1 lời gọi LLM (callLlmJson,
 *  ổn trên claude-cli). Fail-safe: lỗi/null → trả null, caller giữ hits. */
async function gradeHits(
  db: DB,
  companyId: string,
  query: string,
  hits: KnowledgeHit[],
  userId?: string,
): Promise<GradeResult | null> {
  if (!hits.length) return null;
  const payload =
    `Câu hỏi: ${query}\n\nCác đoạn:\n` +
    hits.map((h) => `[id=${h.chunkId}] ${h.content.slice(0, GRADE_CHUNK_CHARS)}`).join("\n\n");
  return callLlmJson<GradeResult>(db, companyId, {
    system: GRADE_SYSTEM,
    user: payload,
    maxTokens: 512,
    userId,
  });
}

export interface AgenticRetrieveOpts extends KnowledgeSearchOpts {
  /** Bật query-rewrite (chế độ Deep). false (mặc định, Fast) = tìm thẳng
   *  bằng câu hỏi gốc, KHÔNG tốn lời gọi LLM thêm. */
  plan?: boolean;
  /** Bật CRAG grading + tự sửa (chế độ Deep). Chỉ chấm khi top-score mơ hồ
   *  (< STRONG_SCORE) nên đa số truy vấn tốt không tốn LLM thêm. */
  grade?: boolean;
  /** Bật graph expansion (lấy đoạn lân cận cùng nguồn) + nén ngữ cảnh.
   *  Rẻ (1 query DB, hàm thuần) nhưng đổi hình dạng hit → bật ở chế độ Deep. */
  expand?: boolean;
  /** Bật re-rank bằng LLM (chế độ Deep) — xếp lại theo độ liên quan. */
  rerank?: boolean;
  /** User hiện tại — ưu tiên profile LLM cá nhân khi rewrite/grade/rerank. */
  userId?: string;
}

export interface AgenticRetrieveResult {
  hits: KnowledgeHit[];
  /** Các truy vấn thực sự đã chạy (sau rewrite) — cho hiển thị/telemetry. */
  queries: string[];
  /** Grader kết luận tập hits lạc đề và không sửa được — caller nên cẩn
   *  trọng (vd nhắc model nói "không tìm thấy" thay vì cố trả lời). */
  gradedOut?: boolean;
}

/** Lõi truy hồi orchestrated dùng chung cho mọi adapter (gồm claude-cli).
 *  P1: plan (tuỳ chọn) → search song song → gộp/khử trùng.
 *  [P2 hook] sẽ chèn grade(query, hits) + correct trước khi trả về. */
export async function agenticRetrieve(
  db: DB,
  companyId: string,
  userQuery: string,
  opts: AgenticRetrieveOpts = {},
): Promise<AgenticRetrieveResult> {
  const q = userQuery.trim();
  if (!q) return { hits: [], queries: [] };

  const limit = Math.min(20, Math.max(1, opts.limit ?? 5));
  // Truyền tiếp acl (user/nhóm) + sourceIds (scope agent) xuống mọi lần search.
  const searchOpts: KnowledgeSearchOpts = {
    limit,
    sourceKind: opts.sourceKind,
    acl: opts.acl,
    sourceIds: opts.sourceIds,
  };

  const queries = opts.plan ? await planQueries(db, companyId, q, opts.userId) : [q];

  // Khi expand/rerank: lấy rộng ứng viên hơn rồi mới tinh lọc về `limit`.
  const wide = opts.expand === true || opts.rerank === true;
  const candLimit = wide ? Math.min(20, limit * 3) : limit;
  const candOpts: KnowledgeSearchOpts = { ...searchOpts, limit: candLimit };

  // 1 query → khỏi gộp. Nhiều query → search song song rồi merge/dedupe.
  const lists = await Promise.all(
    queries.map((qq) => knowledgeSearch(db, companyId, qq, candOpts)),
  );
  let hits = lists.length <= 1 ? (lists[0] ?? []).slice(0, candLimit) : mergeHits(lists, candLimit);

  // Graph expansion (đoạn lân cận) → nén (gộp đoạn liền kề) → re-rank LLM →
  // cắt top `limit`. Mỗi bước fail-safe; Fast mode (không cờ) bỏ qua hết.
  if (opts.expand) hits = await expandNeighbors(db, companyId, hits);
  if (opts.expand) hits = mergeContiguous(hits);
  if (opts.rerank) hits = await rerankHits(db, companyId, q, hits, opts.userId);
  hits = hits.slice(0, limit);

  // CRAG: chỉ chấm khi bật grade VÀ top-score mơ hồ (< STRONG). Đa số
  // truy vấn tốt vượt ngưỡng → bỏ qua, không tốn LLM.
  let gradedOut = false;
  if (opts.grade && hits.length && (hits[0]?.score ?? 0) < STRONG_SCORE) {
    const g = await gradeHits(db, companyId, q, hits, opts.userId);
    if (g) {
      if (g.relevant === false) {
        const sq = g.suggestedQuery?.trim();
        if (sq) {
          // Tự sửa: tìm lại 1 LẦN bằng truy vấn grader đề xuất.
          hits = await knowledgeSearch(db, companyId, sq, searchOpts);
          queries.push(sq);
          gradedOut = hits.length === 0;
        } else {
          gradedOut = true; // lạc đề, không có gợi ý sửa
        }
      } else {
        // Liên quan: giữ đúng các đoạn grader cho là dùng được.
        hits = filterUsable(hits, g.usableChunkIds);
      }
    }
    // g === null → fail-safe: giữ nguyên hits.
  }

  return { hits, queries, gradedOut };
}
