/* Port TR_DINHMUC_CHIPHI_SANPHAM_DELETEBYID — xoá dòng định mức chi phí
   sản phẩm theo id.
   Nguồn: migration-plan/ui/proc-bodies/tr_dinhmuc_chiphi_sanpham_deletebyid.sql

   Bảng tr_dinhmuc_chiphi_sanpham mới import (import-items-composite.json) —
   PK nguồn uniqueidentifier → field "id" kiểu text, so sánh chuỗi. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trDinhmucChiphiSanphamDeletebyid(
  db: DB,
  companyId: string,
  args: { id: string },
): Promise<number> {
  if (!args.id) throw new Error("Thiếu id");

  const t = await procTable(db, companyId, "tr_dinhmuc_chiphi_sanpham");
  // Proc gốc: DELETE tr_dinhmuc_chiphi_sanpham WHERE id = @id.
  // Hệ mới dùng soft-delete (deleted_at) cho bảng thật — chuẩn thay cho DELETE.
  return t.softDeleteWhere(sql`${t.text("id")} = ${args.id}`);
}
