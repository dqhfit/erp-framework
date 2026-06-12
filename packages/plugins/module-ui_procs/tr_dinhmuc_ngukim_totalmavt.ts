/* Port TR_DINHMUC_NGUKIM_TOTALMAVT — tổng số lượng vật tư ngũ kim theo mã
   vật tư của 1 sản phẩm (soluong_tong = soluong nhân hệ số @SOLUONG).
   Nguồn: migration-plan/ui/proc-bodies/tr_dinhmuc_ngukim_totalmavt.sql
   Aggregate 1 bảng duy nhất → compose SQL thô qua procTable.

   Tên field theo field-map (lowercase): HWforWW/HWforPacking/HWforAI →
   hwforww/hwforpacking/hwforai (kiểu boolean). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable, rows } from "../src/proc-table";

export async function trDinhmucNgukimTotalmavt(
  db: DB,
  companyId: string,
  args: {
    masp: string;
    soluong?: number;
  },
): Promise<
  Array<{
    masp: string | null;
    mavt: string | null;
    hwforww: boolean | null;
    hwforpacking: boolean | null;
    hwforai: boolean | null;
    soluong: number;
    soluong_tong: number;
  }>
> {
  if (!args.masp) throw new Error("Thiếu masp");

  // @SOLUONG mặc định 1 nếu không truyền (T-SQL: @SOLUONG INT = 1)
  const soluong = args.soluong ?? 1;

  const t = await procTable(db, companyId, "tr_dinhmuc_ngukim");

  // Proc gốc: ISNULL(ccode,'') <> '000' → COALESCE phía PG
  const res = await db.execute(sql`
    SELECT
      ${t.text("masp")} AS masp,
      ${t.text("mavt")} AS mavt,
      ${t.bool("hwforww")} AS hwforww,
      ${t.bool("hwforpacking")} AS hwforpacking,
      ${t.bool("hwforai")} AS hwforai,
      SUM(${t.num("soluong")}) AS soluong,
      SUM(${t.num("soluong")} * ${soluong}) AS soluong_tong
    FROM ${t.tbl}
    WHERE ${t.scope}
      AND ${t.text("masp")} = ${args.masp}
      AND COALESCE(${t.text("ccode")}, '') <> '000'
    GROUP BY ${t.text("masp")}, ${t.text("mavt")}, ${t.bool("hwforww")},
      ${t.bool("hwforpacking")}, ${t.bool("hwforai")}
  `);

  return rows<{
    masp: string | null;
    mavt: string | null;
    hwforww: boolean | null;
    hwforpacking: boolean | null;
    hwforai: boolean | null;
    soluong: unknown;
    soluong_tong: unknown;
  }>(res).map((r) => ({
    masp: r.masp,
    mavt: r.mavt,
    hwforww: r.hwforww,
    hwforpacking: r.hwforpacking,
    hwforai: r.hwforai,
    soluong: Number(r.soluong ?? 0),
    soluong_tong: Number(r.soluong_tong ?? 0),
  }));
}
