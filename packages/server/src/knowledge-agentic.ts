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
  /** User hiện tại — ưu tiên profile LLM cá nhân khi rewrite/grade. */
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

  // 1 query → khỏi gộp. Nhiều query → search song song rồi merge/dedupe.
  const lists = await Promise.all(
    queries.map((qq) => knowledgeSearch(db, companyId, qq, searchOpts)),
  );
  let hits = lists.length <= 1 ? (lists[0] ?? []).slice(0, limit) : mergeHits(lists, limit);

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
