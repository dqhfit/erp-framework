/* Port TR_CTCONT_DELETEBYID — xoá 1 dòng chi tiết container theo id.
   Proc gốc DELETE thật theo PK int — hệ mới dùng soft-delete (deleted_at)
   cho bảng thật, chuẩn thay cho DELETE.
   Nguồn: migration-plan/ui/proc-bodies/tr_ctcont_deletebyid.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trCtcontDeletebyid(
  db: DB,
  companyId: string,
  args: { id: number },
): Promise<number> {
  if (args.id == null) throw new Error("Thiếu id");

  const t = await procTable(db, companyId, "tr_ctcont");
  return t.softDeleteWhere(sql`${t.num("id")} = ${args.id}`);
}
