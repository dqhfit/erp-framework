import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

export async function trDinhmucGovanM3total(
  db: DB,
  companyId: string,
  args: {
    masp: string;
    soluong?: number;
  },
): Promise<Array<{ masp: string; nguyenlieu: string; m3_tc: number }>> {
  if (!args.masp) throw new Error("Thiếu masp");

  // @SOLUONG mặc định 1 nếu không truyền
  const soluong = args.soluong ?? 1;

  const r = await db.execute<{
    masp: string;
    nguyenlieu: string;
    m3_tc: number;
  }>(sql`
    SELECT
      t.masp,
      t.nguyenlieu,
      SUM(t.m3_tc * ${soluong}) AS m3_tc
    FROM tr_dinhmuc_govan t
    WHERE t.company_id = ${companyId}
      AND t.deleted_at IS NULL
      AND t.masp = ${args.masp}
      AND t.nguyenlieu IS NOT NULL
      AND t.nguyenlieu NOT IN ('', '0')
    GROUP BY t.masp, t.nguyenlieu
    HAVING SUM(t.m3_tc * ${soluong}) > 0
    ORDER BY t.nguyenlieu
  `);

  return r as unknown as Array<{
    masp: string;
    nguyenlieu: string;
    m3_tc: number;
  }>;
}
