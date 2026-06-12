/* Port TR_TIENDO_CHUYENSON_GETBYKHUVUC2 — tiến độ chuyền sơn theo khu vực
   cho MỘT đơn hàng chỉ định, pivot 15 bước sơn (BUOC1..BUOC15).
   Nguồn: migration-plan/ui/proc-bodies/tr_tiendo_chuyenson_getbykhuvuc2.sql

   Khác GETBYKHUVUC: proc gốc comment hết khối @DANHSACH_DONHANG (tr_order
   Finished=0 + f_cancelled='N') và lọc thẳng A.donhang = @madonhang —
   tức KHÔNG kiểm tra trạng thái đơn, nhận thêm tham số madonhang.

   2 bảng → KHÔNG join 1 câu (biểu thức procTable không mang alias): tách
   query + ghép trong JS (batch-stitch):
     1. tr_tiendo_chuyenson (A) theo (makhuvuc, donhang).
     2. tr_release_govan (B) theo madonhang — INNER JOIN trên (donhang,
        masp, mact): dòng A không khớp B nào → loại; A khớp N dòng B →
        dòng A lặp N lần trong SUM (giữ đúng ngữ nghĩa join của SQL).
     3. Pivot trong JS:
        - soluong_donhang = SUM(DISTINCT B.soluong_can) — cộng các GIÁ TRỊ
          distinct của soluong_can trong nhóm; toàn NULL → null.
        - BUOCn = SUM(CASE buocson='BUOCn' THEN A.soluong END) qua join
          → mỗi dòng A đóng góp soluong × (số dòng B khớp); nhóm không có
          đóng góp non-null → null.

   Logic pivot lặp lại từ tr_tiendo_chuyenson_getbykhuvuc.ts có chủ đích:
   loader module-procs đăng ký MỌI export là function (arity >= 2) nên
   helper chung không được export khỏi file proc. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

const BUOC_COUNT = 15;

interface TiendoChuyensonRow {
  makhuvuc: string | null;
  donhang: string | null;
  masp: string | null;
  mact: string | null;
  tenct: string | null;
  soluong_donhang: number | null;
  BUOC1: number | null;
  BUOC2: number | null;
  BUOC3: number | null;
  BUOC4: number | null;
  BUOC5: number | null;
  BUOC6: number | null;
  BUOC7: number | null;
  BUOC8: number | null;
  BUOC9: number | null;
  BUOC10: number | null;
  BUOC11: number | null;
  BUOC12: number | null;
  BUOC13: number | null;
  BUOC14: number | null;
  BUOC15: number | null;
}

/** Ép giá trị về number, không hợp lệ/null → null (SUM của SQL bỏ NULL). */
function numOf(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Join tr_release_govan + gom nhóm + pivot BUOC1..15 cho tập dòng
 *  tr_tiendo_chuyenson đã lọc. KHÔNG export (xem comment đầu file). */
async function pivotTiendoChuyenson(
  db: DB,
  companyId: string,
  tdRows: Array<Record<string, unknown>>,
): Promise<TiendoChuyensonRow[]> {
  if (tdRows.length === 0) return [];

  // tr_release_govan theo madonhang của tập A — index theo khoá join
  const donhangs = [...new Set(tdRows.map((r) => String(r.donhang)))];
  const rg = await procTable(db, companyId, "tr_release_govan");
  const rgRows = await rg.listWhere(sql`
    ${rg.text("madonhang")} IN (${sql.join(
      donhangs.map((v) => sql`${v}`),
      sql`, `,
    )})
  `);
  // (madonhang, masp, mact) → danh sách soluong_can của các dòng B khớp
  // (giữ cả NULL để đếm đúng số dòng lặp của join)
  const bByKey = new Map<string, Array<number | null>>();
  for (const b of rgRows) {
    if (b.madonhang == null || b.masp == null || b.mact == null) continue;
    const key = [b.madonhang, b.masp, b.mact].map(String).join("\u0001");
    const list = bByKey.get(key) ?? [];
    list.push(numOf(b.soluong_can));
    bByKey.set(key, list);
  }

  const asText = (v: unknown): string | null => (v == null ? null : String(v));

  interface Bucket {
    makhuvuc: string | null;
    donhang: string | null;
    masp: string | null;
    mact: string | null;
    tenct: string | null;
    canSet: Set<number>;
    buoc: Array<number | null>;
  }
  const buckets = new Map<string, Bucket>();

  for (const a of tdRows) {
    if (a.donhang == null || a.masp == null || a.mact == null) continue;
    const joinKey = [a.donhang, a.masp, a.mact].map(String).join("\u0001");
    const bList = bByKey.get(joinKey);
    if (!bList || bList.length === 0) continue; // INNER JOIN — không khớp B → loại

    const groupKey = [a.makhuvuc, a.donhang, a.masp, a.mact, a.tenct]
      .map((v) => String(v))
      .join("\u0001");
    let bucket = buckets.get(groupKey);
    if (!bucket) {
      bucket = {
        makhuvuc: asText(a.makhuvuc),
        donhang: asText(a.donhang),
        masp: asText(a.masp),
        mact: asText(a.mact),
        tenct: asText(a.tenct),
        canSet: new Set<number>(),
        buoc: Array.from({ length: BUOC_COUNT }, () => null),
      };
      buckets.set(groupKey, bucket);
    }
    for (const can of bList) {
      if (can != null) bucket.canSet.add(can);
    }
    // buocson so sánh theo collation CI của MSSQL → chuẩn hoá trim + upper
    const m = /^BUOC(\d{1,2})$/.exec(
      String(a.buocson ?? "")
        .trim()
        .toUpperCase(),
    );
    const idx = m ? Number(m[1]) : 0;
    const soluong = numOf(a.soluong);
    if (idx >= 1 && idx <= BUOC_COUNT && soluong != null) {
      // dòng A lặp lại theo số dòng B khớp trong join gốc
      bucket.buoc[idx - 1] = (bucket.buoc[idx - 1] ?? 0) + soluong * bList.length;
    }
  }

  // Proc gốc không ORDER BY — sort nhẹ cho output ổn định
  const out: TiendoChuyensonRow[] = [...buckets.values()].map((b) => ({
    makhuvuc: b.makhuvuc,
    donhang: b.donhang,
    masp: b.masp,
    mact: b.mact,
    tenct: b.tenct,
    soluong_donhang: b.canSet.size === 0 ? null : [...b.canSet].reduce((s, v) => s + v, 0),
    BUOC1: b.buoc[0] ?? null,
    BUOC2: b.buoc[1] ?? null,
    BUOC3: b.buoc[2] ?? null,
    BUOC4: b.buoc[3] ?? null,
    BUOC5: b.buoc[4] ?? null,
    BUOC6: b.buoc[5] ?? null,
    BUOC7: b.buoc[6] ?? null,
    BUOC8: b.buoc[7] ?? null,
    BUOC9: b.buoc[8] ?? null,
    BUOC10: b.buoc[9] ?? null,
    BUOC11: b.buoc[10] ?? null,
    BUOC12: b.buoc[11] ?? null,
    BUOC13: b.buoc[12] ?? null,
    BUOC14: b.buoc[13] ?? null,
    BUOC15: b.buoc[14] ?? null,
  }));
  return out.sort(
    (a, z) =>
      (a.donhang ?? "").localeCompare(z.donhang ?? "") ||
      (a.masp ?? "").localeCompare(z.masp ?? "") ||
      (a.mact ?? "").localeCompare(z.mact ?? ""),
  );
}

export async function trTiendoChuyensonGetbykhuvuc2(
  db: DB,
  companyId: string,
  args: { makhuvuc: string; madonhang: string },
): Promise<TiendoChuyensonRow[]> {
  if (!args.makhuvuc) throw new Error("Thiếu makhuvuc");
  if (!args.madonhang) throw new Error("Thiếu madonhang");

  // Lọc thẳng theo (makhuvuc, donhang) — KHÔNG qua danh sách đơn tr_order
  const td = await procTable(db, companyId, "tr_tiendo_chuyenson");
  const tdRows = await td.listWhere(sql`
    ${td.text("makhuvuc")} = ${args.makhuvuc}
    AND ${td.text("donhang")} = ${args.madonhang}
  `);

  return pivotTiendoChuyenson(db, companyId, tdRows);
}
