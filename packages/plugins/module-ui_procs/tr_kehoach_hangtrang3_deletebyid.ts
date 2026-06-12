/* Port TR_KEHOACH_HANGTRANG3_DELETEBYID — xoá 1 dòng kế hoạch hàng trắng
   (bản 3) theo id (uniqueidentifier nguồn). Hệ mới dùng soft-delete
   (deleted_at) thay cho DELETE của T-SQL.
   Nguồn: migration-plan/ui/proc-bodies/tr_kehoach_hangtrang3_deletebyid.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trKehoachHangtrang3Deletebyid(
  db: DB,
  companyId: string,
  args: {
    id: string;
  },
): Promise<number> {
  if (!args.id) throw new Error("Thiếu id");

  const t = await procTable(db, companyId, "tr_kehoach_hangtrang3");
  return t.softDeleteWhere(sql`${t.text("id")} = ${args.id}`);
}
