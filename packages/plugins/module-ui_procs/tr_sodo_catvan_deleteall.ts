/* Port TR_SODO_CATVAN_DELETEALL — xoá toàn bộ dòng sơ đồ cắt ván
   thuộc 1 phiếu (head_id).
   Nguồn: migration-plan/ui/proc-bodies/tr_sodo_catvan_deleteall.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trSodoCatvanDeleteall(
  db: DB,
  companyId: string,
  args: { head_id: string },
): Promise<number> {
  if (!args.head_id) throw new Error("Thiếu head_id");

  const t = await procTable(db, companyId, "tr_sodo_catvan");
  // Proc gốc: DELETE tr_sodo_catvan WHERE head_id = @head_id (uniqueidentifier).
  // Hệ mới dùng soft-delete (deleted_at) cho bảng thật — chuẩn thay cho DELETE.
  return t.softDeleteWhere(sql`${t.text("head_id")} = ${args.head_id}`);
}
