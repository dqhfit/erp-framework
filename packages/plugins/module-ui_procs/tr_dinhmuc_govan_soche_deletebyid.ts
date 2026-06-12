/* Port TR_DINHMUC_GOVAN_SOCHE_DELETEBYID — xoá 1 dòng định mức gỗ ván
   sơ chế theo id.
   Nguồn: migration-plan/ui/proc-bodies/tr_dinhmuc_govan_soche_deletebyid.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trDinhmucGovanSocheDeletebyid(
  db: DB,
  companyId: string,
  args: { id: string },
): Promise<number> {
  if (!args.id) throw new Error("Thiếu id");

  const t = await procTable(db, companyId, "tr_dinhmuc_govan_soche");
  // Proc gốc: DELETE tr_dinhmuc_govan_soche WHERE id = @id (PK nguồn uniqueidentifier).
  // Hệ mới dùng soft-delete (deleted_at) cho bảng thật — chuẩn thay cho DELETE.
  return t.softDeleteWhere(sql`${t.text("id")} = ${args.id}`);
}
