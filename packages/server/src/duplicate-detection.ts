/* ==========================================================
   duplicate-detection.ts — Tìm bản ghi tương tự (fuzzy match).
   Dùng Levenshtein distance + normalisation đơn giản (lowercase,
   bỏ dấu vi). Quét tất cả record active, tính similarity score
   tổng hợp trên các field key chỉ định, trả top-K.
   Đủ cho phát hiện trùng khách hàng / nhà cung cấp đơn giản.
   ========================================================== */
import { and, eq, sql } from "drizzle-orm";
import { entityRecords } from "@erp-framework/db";
import type { DB } from "./db";

/** Bỏ dấu Việt + lowercase + collapse whitespace. */
function normalize(s: string): string {
  return s.normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "D")
    .toLowerCase().trim().replace(/\s+/g, " ");
}

/** Levenshtein distance — O(m*n) DP. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = a.length, n = b.length;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(
        cur[j - 1]! + 1,
        prev[j]! + 1,
        prev[j - 1]! + cost,
      );
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n]!;
}

/** Similarity 0..1 từ Levenshtein (1 - dist/maxLen). */
function similarity(a: string, b: string): number {
  const na = normalize(a), nb = normalize(b);
  const max = Math.max(na.length, nb.length);
  if (max === 0) return 1;
  return 1 - levenshtein(na, nb) / max;
}

/** Tìm record tương tự với input values. Trả top-K record id + score.
 *  v2: pre-filter bằng pg_trgm GIN index trước khi tính Levenshtein —
 *  giảm dataset từ N → ~K*similarity (nhanh hơn 10-100x trên dataset lớn). */
export async function findDuplicateRecords(
  db: DB, companyId: string, entityId: string,
  fieldKeys: string[], values: Record<string, string>, limit: number,
): Promise<Array<{ recordId: string; score: number; data: Record<string, unknown> }>> {
  // Build chuỗi query gộp các value để trigram pre-filter.
  const queryText = fieldKeys.map((k) => values[k] ?? "").filter(Boolean).join(" ");
  let rows: Array<{ id: string; data: unknown }>;
  if (queryText.length >= 3) {
    // Trigram pre-filter — top 200 records giống nhất theo similarity.
    rows = await db.execute(sql`
      SELECT id, data FROM entity_records
      WHERE company_id = ${companyId}::uuid
        AND entity_id = ${entityId}::uuid
        AND deleted_at IS NULL
        AND similarity(data::text, ${queryText}) > 0.1
      ORDER BY similarity(data::text, ${queryText}) DESC
      LIMIT 200
    `) as unknown as Array<{ id: string; data: unknown }>;
  } else {
    // Query quá ngắn → full scan với cap.
    rows = await db.select({ id: entityRecords.id, data: entityRecords.data })
      .from(entityRecords).where(and(
        eq(entityRecords.companyId, companyId),
        eq(entityRecords.entityId, entityId),
        sql`${entityRecords.deletedAt} IS NULL`,
      )).limit(2000);
  }

  const scored = rows.map((r) => {
    const data = (r.data ?? {}) as Record<string, unknown>;
    // Trung bình similarity trên các field key.
    let total = 0; let n = 0;
    for (const k of fieldKeys) {
      const a = String(values[k] ?? "");
      const b = String(data[k] ?? "");
      if (!a || !b) continue;
      total += similarity(a, b);
      n += 1;
    }
    return { recordId: r.id, score: n > 0 ? total / n : 0, data };
  });
  return scored
    .filter((s) => s.score > 0.5) // ngưỡng 50% — chỉnh được nếu cần
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
