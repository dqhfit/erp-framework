/* Port TINHGIA_NGUYENLIEU_SON — tổng giá nguyên liệu sơn của 1 sản phẩm.
   Nguồn: migration-plan/ui/proc-bodies/tinhgia_nguyenlieu_son.sql
   3 bảng: tr_dinhmuc_son3 (A) JOIN tr_dinhmuc_son3_metvuong (B) theo
   matson + masp, JOIN tr_material (C) theo A.mact = C.mavt — biểu thức
   procTable không mang alias nên tách 3 query + ghép JS:
     1. A: các dòng định mức sơn của masp (mact, matson, soluong)
     2. B: mét vuông theo matson của masp (giữ 1-N — JOIN nhân dòng)
     3. C: lookup tr_material theo mact (dongia + loaitien, dòng đầu)
   Trên MỖI dòng ghép (A x B x C):
     tongdongia_metvuong += soluong × dongia × (USD ? tigia : 1)
     tongdongia_sanpham  += soluong × metvuong × dongia × (USD ? tigia : 1)
   INNER JOIN gốc → dòng thiếu B hoặc C bị loại. 2 OUTPUT param → trả
   [{ tongdongia_sanpham, tongdongia_metvuong }]; SUM không có dòng
   nào → NULL như T-SQL. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable, rows } from "../src/proc-table";

export async function tinhgiaNguyenlieuSon(
  db: DB,
  companyId: string,
  args: {
    masp: string;
    tigia?: number;
  },
): Promise<Array<{ tongdongia_sanpham: number | null; tongdongia_metvuong: number | null }>> {
  if (!args.masp) throw new Error("Thiếu masp");

  // T-SQL: @tigia float = 25400
  const tigia = args.tigia ?? 25400;

  // Bước 1: định mức sơn của sản phẩm
  const tA = await procTable(db, companyId, "tr_dinhmuc_son3");
  const resA = await db.execute(sql`
    SELECT ${tA.text("mact")} AS mact,
           ${tA.text("matson")} AS matson,
           ${tA.num("soluong")} AS soluong
    FROM ${tA.tbl}
    WHERE ${tA.scope} AND ${tA.text("masp")} = ${args.masp}
  `);
  const dmRows = rows<{ mact: string | null; matson: string | null; soluong: unknown }>(resA);
  if (dmRows.length === 0) {
    return [{ tongdongia_sanpham: null, tongdongia_metvuong: null }];
  }

  // Bước 2: mét vuông theo matson của sản phẩm — giữ mảng theo key để
  // tái hiện JOIN 1-N (nhiều dòng B cùng matson → nhân dòng như SQL)
  const tB = await procTable(db, companyId, "tr_dinhmuc_son3_metvuong");
  const resB = await db.execute(sql`
    SELECT ${tB.text("matson")} AS matson, ${tB.num("metvuong")} AS metvuong
    FROM ${tB.tbl}
    WHERE ${tB.scope} AND ${tB.text("masp")} = ${args.masp}
  `);
  const mvByMatson = new Map<string, number[]>();
  for (const b of rows<{ matson: string | null; metvuong: unknown }>(resB)) {
    if (b.matson == null) continue;
    const list = mvByMatson.get(b.matson) ?? [];
    list.push(Number(b.metvuong ?? 0));
    mvByMatson.set(b.matson, list);
  }

  // Bước 3: lookup tr_material theo mact (dongia + loaitien)
  const macts = [...new Set(dmRows.map((r) => r.mact).filter((v): v is string => v != null))];
  const matByMavt = new Map<string, Record<string, unknown>>();
  if (macts.length > 0) {
    const m = await procTable(db, companyId, "tr_material");
    const mats = await m.listWhere(sql`
      ${m.text("mavt")} IN (${sql.join(
        macts.map((v) => sql`${v}`),
        sql`, `,
      )})
    `);
    for (const mat of mats) {
      const key = mat.mavt == null ? null : String(mat.mavt);
      if (key != null && !matByMavt.has(key)) matByMavt.set(key, mat);
    }
  }

  // Ghép A x B x C — INNER JOIN: thiếu B hoặc C → bỏ dòng
  let sumMetvuong: number | null = null;
  let sumSanpham: number | null = null;
  for (const a of dmRows) {
    const mvList = a.matson == null ? undefined : mvByMatson.get(a.matson);
    const mat = a.mact == null ? undefined : matByMavt.get(a.mact);
    if (!mvList || mvList.length === 0 || !mat) continue;
    const soluong = Number(a.soluong ?? 0);
    const dongia = Number(mat.dongia ?? 0);
    const heso = String(mat.loaitien ?? "") === "USD" ? tigia : 1;
    for (const metvuong of mvList) {
      sumMetvuong = (sumMetvuong ?? 0) + soluong * dongia * heso;
      sumSanpham = (sumSanpham ?? 0) + soluong * metvuong * dongia * heso;
    }
  }
  return [{ tongdongia_sanpham: sumSanpham, tongdongia_metvuong: sumMetvuong }];
}
