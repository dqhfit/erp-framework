/* Port SAL_BAOGIA_GOVAN_CHITIET_DELETEBYID — xoá 1 dòng chi tiết báo giá
   gỗ ván theo id dòng.
   Nguồn: migration-plan/ui/proc-bodies/sal_baogia_govan_chitiet_deletebyid.sql
   DELETE gốc → soft-delete (chuẩn hệ mới). PK nguồn uniqueidentifier →
   field "id" so sánh text. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function salBaogiaGovanChitietDeletebyid(
  db: DB,
  companyId: string,
  args: {
    id: string;
  },
): Promise<number> {
  if (!args.id) throw new Error("Thiếu id");

  const t = await procTable(db, companyId, "sal_baogia_govan_chitiet");
  // Proc gốc: DELETE sal_baogia_govan_chitiet WHERE id = @id
  return t.softDeleteWhere(sql`${t.text("id")} = ${args.id}`);
}
