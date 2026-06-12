/* Port TR_GIAOHANG_CHITIET_DELETEBYID — xoá dòng chi tiết giao hàng theo
   id nguồn (uniqueidentifier). Proc gốc DELETE thật; hệ mới chuẩn
   soft-delete (deleted_at) cho bảng thật.
   Nguồn: migration-plan/ui/proc-bodies/tr_giaohang_chitiet_deletebyid.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trGiaohangChitietDeletebyid(
  db: DB,
  companyId: string,
  args: { id: string },
): Promise<number> {
  if (!args.id) throw new Error("Thiếu id");

  const t = await procTable(db, companyId, "tr_giaohang_chitiet");
  return t.softDeleteWhere(sql`${t.text("id")} = ${args.id}`);
}
