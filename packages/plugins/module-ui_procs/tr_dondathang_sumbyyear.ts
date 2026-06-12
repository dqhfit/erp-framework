/* Port TR_DONDATHANG_SUMBYYEAR — tổng tiền đơn đặt hàng theo năm, nhóm theo
   (loại ĐĐH, NCC, loại tiền, người tạo), pivot 12 tháng D1..D12.
   Nguồn: migration-plan/ui/proc-bodies/tr_dondathang_sumbyyear.sql

   2 bảng (tr_dondathang INNER JOIN tr_dondathang_chitiet theo maddh) →
   tách 2 query + ghép JS (batch-stitch):
     1. tr_dondathang: header active + phê duyệt, lọc năm bằng
        EXTRACT(YEAR FROM ngaydat) = @year; lấy luôn EXTRACT(MONTH) làm
        tháng pivot (cột ngaydat kiểu date text ISO).
     2. tr_dondathang_chitiet: aggregate 1 bảng SUM(dongia*soluong) theo
        (maddh, loaitien) — ISNULL(loaitien,'') → COALESCE phía PG.
     3. Ghép trong JS: mỗi header nhân với các nhóm chi tiết của maddh đó
        (INNER JOIN → header không có chi tiết bị loại); gom theo
        (loaiddh, mancc, tenncc, loaitien, create_by); D<n> ELSE 0 của
        T-SQL → khởi tạo 12 tháng = 0.
   Lưu ý: SUM(dongia*soluong) của T-SQL bỏ dòng có dongia/soluong NULL —
   phía PG giữ nguyên biểu thức nhân (NULL lan truyền, SUM bỏ NULL);
   nhóm toàn NULL → tien null → JS quy về 0. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable, rows } from "../src/proc-table";

interface SumByYearRow {
  loaiddh: string | null;
  mancc: string | null;
  tenncc: string | null;
  loaitien: string;
  create_by: string | null;
  tongtien: number;
  D1: number;
  D2: number;
  D3: number;
  D4: number;
  D5: number;
  D6: number;
  D7: number;
  D8: number;
  D9: number;
  D10: number;
  D11: number;
  D12: number;
}

export async function trDondathangSumbyyear(
  db: DB,
  companyId: string,
  args: {
    year: number;
  },
): Promise<SumByYearRow[]> {
  if (args.year == null) throw new Error("Thiếu year");

  // Bước 1: header đơn đặt hàng trong năm. pheduyet là nvarchar(2) chứa
  // '0'/'1'/'2'/'-1' — T-SQL `pheduyet = 1` ép nvarchar→int nên so SỐ
  // (= 1), KHÔNG so boolean ('2' không phải bool, phải bị loại êm).
  const ddh = await procTable(db, companyId, "tr_dondathang");
  const headRes = await db.execute(sql`
    SELECT
      ${ddh.text("maddh")} AS maddh,
      ${ddh.text("loaiddh")} AS loaiddh,
      ${ddh.text("mancc")} AS mancc,
      ${ddh.text("tenncc")} AS tenncc,
      ${ddh.text("create_by")} AS create_by,
      EXTRACT(MONTH FROM ${ddh.ts("ngaydat")})::int AS thang
    FROM ${ddh.tbl}
    WHERE ${ddh.scope}
      AND ${ddh.bool("active")} = true
      AND ${ddh.num("pheduyet")} = 1
      AND EXTRACT(YEAR FROM ${ddh.ts("ngaydat")}) = ${args.year}
  `);
  const heads = rows<{
    maddh: string | null;
    loaiddh: string | null;
    mancc: string | null;
    tenncc: string | null;
    create_by: string | null;
    thang: number | null;
  }>(headRes);
  const validHeads = heads.filter((h) => h.maddh != null && h.thang != null);
  if (validHeads.length === 0) return [];

  // Bước 2: aggregate chi tiết theo (maddh, loaitien)
  const maddhs = [...new Set(validHeads.map((h) => String(h.maddh)))];
  const ct = await procTable(db, companyId, "tr_dondathang_chitiet");
  const detRes = await db.execute(sql`
    SELECT
      ${ct.text("maddh")} AS maddh,
      COALESCE(${ct.text("loaitien")}, '') AS loaitien,
      SUM(${ct.num("dongia")} * ${ct.num("soluong")}) AS tien
    FROM ${ct.tbl}
    WHERE ${ct.scope}
      AND ${ct.text("maddh")} IN (${sql.join(
        maddhs.map((v) => sql`${v}`),
        sql`, `,
      )})
    GROUP BY ${ct.text("maddh")}, COALESCE(${ct.text("loaitien")}, '')
  `);
  const detByMaddh = new Map<string, Array<{ loaitien: string; tien: number }>>();
  for (const d of rows<{ maddh: string | null; loaitien: string; tien: unknown }>(detRes)) {
    if (d.maddh == null) continue;
    const list = detByMaddh.get(d.maddh) ?? [];
    list.push({ loaitien: d.loaitien ?? "", tien: Number(d.tien ?? 0) });
    detByMaddh.set(d.maddh, list);
  }

  // Bước 3: ghép header × nhóm chi tiết, gom theo khoá GROUP BY của proc gốc
  const out = new Map<string, SumByYearRow>();
  for (const h of validHeads) {
    const dets = detByMaddh.get(String(h.maddh));
    if (!dets) continue; // INNER JOIN — header không có chi tiết bị loại
    for (const d of dets) {
      const key = [h.loaiddh, h.mancc, h.tenncc, d.loaitien, h.create_by]
        .map((v) => String(v))
        .join("\u0001");
      let row = out.get(key);
      if (!row) {
        row = {
          loaiddh: h.loaiddh,
          mancc: h.mancc,
          tenncc: h.tenncc,
          loaitien: d.loaitien,
          create_by: h.create_by,
          tongtien: 0,
          D1: 0,
          D2: 0,
          D3: 0,
          D4: 0,
          D5: 0,
          D6: 0,
          D7: 0,
          D8: 0,
          D9: 0,
          D10: 0,
          D11: 0,
          D12: 0,
        };
        out.set(key, row);
      }
      row.tongtien += d.tien;
      const dKey = `D${h.thang}` as keyof Pick<
        SumByYearRow,
        "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7" | "D8" | "D9" | "D10" | "D11" | "D12"
      >;
      row[dKey] += d.tien;
    }
  }

  // Proc gốc không ORDER BY — sort nhẹ cho output ổn định
  return [...out.values()].sort(
    (a, z) =>
      (a.loaiddh ?? "").localeCompare(z.loaiddh ?? "") ||
      (a.mancc ?? "").localeCompare(z.mancc ?? "") ||
      a.loaitien.localeCompare(z.loaitien) ||
      (a.create_by ?? "").localeCompare(z.create_by ?? ""),
  );
}
