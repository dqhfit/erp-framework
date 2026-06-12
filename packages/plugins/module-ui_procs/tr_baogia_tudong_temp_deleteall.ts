/* Port TR_BAOGIA_TUDONG_TEMP_DELETEALL — xoá toàn bộ dòng temp báo giá
   tự động của 1 user.
   Nguồn: migration-plan/ui/proc-bodies/tr_baogia_tudong_temp_deleteall.sql
   DELETE gốc → soft-delete (chuẩn hệ mới). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trBaogiaTudongTempDeleteall(
  db: DB,
  companyId: string,
  args: {
    username: string;
  },
): Promise<number> {
  if (!args.username) throw new Error("Thiếu username");

  const t = await procTable(db, companyId, "tr_baogia_tudong_temp");
  // Proc gốc: DELETE tr_baogia_tudong_temp WHERE username = @username
  return t.softDeleteWhere(sql`${t.text("username")} = ${args.username}`);
}
