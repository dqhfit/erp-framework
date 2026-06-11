/* Port TR_DINHMUC_GOVAN_M3TOTAL — tổng m3 tiêu chuẩn theo nguyên liệu của 1 sản phẩm.
   Nguồn: migration-plan/ui/proc-bodies/tr_dinhmuc_govan_m3total.sql
   Aggregate 1 bảng duy nhất → compose SQL thô qua procTable (biểu thức cột
   đọc từ meta.storage.columns lúc runtime — đúng cột vật lý f_... hoặc ext). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable, rows } from "../src/proc-table";

export async function trDinhmucGovanM3total(
  db: DB,
  companyId: string,
  args: {
    masp: string;
    soluong?: number;
  },
): Promise<Array<{ masp: string; nguyenlieu: string; m3_tc: number }>> {
  if (!args.masp) throw new Error("Thiếu masp");

  // @SOLUONG mặc định 1 nếu không truyền (T-SQL: @SOLUONG INT = 1)
  const soluong = args.soluong ?? 1;

  const t = await procTable(db, companyId, "tr_dinhmuc_govan");

  // Proc gốc: ISNULL(nguyenlieu,'') NOT IN ('','0') → COALESCE phía PG.
  const res = await db.execute(sql`
    SELECT
      ${t.text("masp")} AS masp,
      ${t.text("nguyenlieu")} AS nguyenlieu,
      SUM(${t.num("m3_tc")} * ${soluong}) AS m3_tc
    FROM ${t.tbl}
    WHERE ${t.scope}
      AND ${t.text("masp")} = ${args.masp}
      AND COALESCE(${t.text("nguyenlieu")}, '') NOT IN ('', '0')
    GROUP BY ${t.text("masp")}, ${t.text("nguyenlieu")}
    HAVING SUM(${t.num("m3_tc")} * ${soluong}) > 0
    ORDER BY ${t.text("nguyenlieu")}
  `);

  return rows<{ masp: string; nguyenlieu: string; m3_tc: unknown }>(res).map((r) => ({
    masp: r.masp,
    nguyenlieu: r.nguyenlieu,
    m3_tc: Number(r.m3_tc ?? 0),
  }));
}
