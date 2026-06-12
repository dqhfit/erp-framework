/* Port TINHGIA_NGUYENLIEU_DGO — tổng giá nguyên liệu đóng gói (VND) của 1 SP.
   Nguồn: migration-plan/ui/proc-bodies/tinhgia_nguyenlieu_dgo.sql
   JOIN tr_dinhmuc_donggoi x tr_material (madonggoi = mavt) → tách 2 query
   + ghép JS (biểu thức procTable không mang alias):
     1. aggregate SUM(soluong) GROUP BY madonggoi trên tr_dinhmuc_donggoi
     2. lookup tr_material theo mavt lấy dongia + loaitien
   loaitien = 'USD' → nhân tỉ giá. INNER JOIN gốc → nhóm không có vật tư
   khớp bị loại. OUTPUT @tongdonagia_vnd → trả [{ tongdonagia_vnd }]
   (giữ nguyên tên gốc kể cả lỗi chính tả). SUM không có dòng nào →
   NULL như T-SQL. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable, rows } from "../src/proc-table";

export async function tinhgiaNguyenlieuDgo(
  db: DB,
  companyId: string,
  args: {
    masp: string;
    tigia?: number;
  },
): Promise<Array<{ tongdonagia_vnd: number | null }>> {
  if (!args.masp) throw new Error("Thiếu masp");

  // T-SQL: @tigia float = 25400
  const tigia = args.tigia ?? 25400;

  const t = await procTable(db, companyId, "tr_dinhmuc_donggoi");

  // Bước 1: tổng số lượng theo mã đóng gói của sản phẩm
  const res = await db.execute(sql`
    SELECT ${t.text("madonggoi")} AS madonggoi, SUM(${t.num("soluong")}) AS soluong
    FROM ${t.tbl}
    WHERE ${t.scope} AND ${t.text("masp")} = ${args.masp}
    GROUP BY ${t.text("madonggoi")}
  `);
  const groups = rows<{ madonggoi: string | null; soluong: unknown }>(res);
  if (groups.length === 0) return [{ tongdonagia_vnd: null }];

  // Bước 2: lookup tr_material theo mavt (dongia + loaitien)
  const mavts = [...new Set(groups.map((g) => g.madonggoi).filter((v): v is string => v != null))];
  const matByMavt = new Map<string, Record<string, unknown>>();
  if (mavts.length > 0) {
    const m = await procTable(db, companyId, "tr_material");
    const mats = await m.listWhere(sql`
      ${m.text("mavt")} IN (${sql.join(
        mavts.map((v) => sql`${v}`),
        sql`, `,
      )})
    `);
    for (const mat of mats) {
      const key = mat.mavt == null ? null : String(mat.mavt);
      if (key != null && !matByMavt.has(key)) matByMavt.set(key, mat);
    }
  }

  // Ghép: SUM(soluong × dongia × (USD ? tigia : 1)) — nhóm thiếu vật tư
  // bị loại (INNER JOIN); không khớp dòng nào → NULL như SUM của T-SQL.
  let total: number | null = null;
  for (const g of groups) {
    const mat = g.madonggoi == null ? undefined : matByMavt.get(g.madonggoi);
    if (!mat) continue;
    const dongia = Number(mat.dongia ?? 0);
    const heso = String(mat.loaitien ?? "") === "USD" ? tigia : 1;
    total = (total ?? 0) + Number(g.soluong ?? 0) * dongia * heso;
  }
  return [{ tongdonagia_vnd: total }];
}
