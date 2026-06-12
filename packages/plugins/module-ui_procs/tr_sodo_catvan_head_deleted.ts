/* Port TR_SODO_CATVAN_HEAD_DELETED — xoá header phiếu sơ đồ cắt ván theo id.
   Nguồn: migration-plan/ui/proc-bodies/tr_sodo_catvan_head_deleted.sql
   LƯU Ý: proc gốc CHỈ xoá header, KHÔNG xoá dòng con tr_sodo_catvan —
   caller (form) tự gọi TR_SODO_CATVAN_DELETEALL trước nếu cần. Giữ nguyên. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trSodoCatvanHeadDeleted(
  db: DB,
  companyId: string,
  args: { id: string },
): Promise<number> {
  if (!args.id) throw new Error("Thiếu id");

  const t = await procTable(db, companyId, "tr_sodo_catvan_head");
  // Proc gốc: DELETE tr_sodo_catvan_head WHERE id = @id (PK nguồn uniqueidentifier).
  // Hệ mới dùng soft-delete (deleted_at) cho bảng thật — chuẩn thay cho DELETE.
  return t.softDeleteWhere(sql`${t.text("id")} = ${args.id}`);
}
