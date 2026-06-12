/* Port TR_DINHMUC_SON3_MAUSON_DELETEBYID — xoá dòng định mức sơn 3
   (màu sơn) theo id.
   Nguồn: migration-plan/ui/proc-bodies/tr_dinhmuc_son3_mauson_deletebyid.sql

   Bảng tr_dinhmuc_son3_mauson mới import (import-items-composite.json) —
   PK nguồn uniqueidentifier → field "id" kiểu text, so sánh chuỗi. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trDinhmucSon3MausonDeletebyid(
  db: DB,
  companyId: string,
  args: { id: string },
): Promise<number> {
  if (!args.id) throw new Error("Thiếu id");

  const t = await procTable(db, companyId, "tr_dinhmuc_son3_mauson");
  // Proc gốc: DELETE tr_dinhmuc_son3_mauson WHERE id = @id.
  // Hệ mới dùng soft-delete (deleted_at) cho bảng thật — chuẩn thay cho DELETE.
  return t.softDeleteWhere(sql`${t.text("id")} = ${args.id}`);
}
