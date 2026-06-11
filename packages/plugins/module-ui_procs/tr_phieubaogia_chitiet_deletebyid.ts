/* Port TR_PHIEUBAOGIA_CHITIET_DELETEBYID — xoá chi tiết phiếu báo giá theo ID.
   Nguồn: migration-plan/ui/proc-bodies/tr_phieubaogia_chitiet_deletebyid.sql
   PK nguồn "ID" uniqueidentifier → field "id" (text, lowercase theo field-map)
   trên entity tr_phieubaogia_chitiet — so sánh chuỗi qua t.text. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trPhieubaogiaChitietDeletebyid(
  db: DB,
  companyId: string,
  args: { id: string },
): Promise<number> {
  if (!args.id) throw new Error("Thiếu id");

  const t = await procTable(db, companyId, "tr_phieubaogia_chitiet");
  // Proc gốc: DELETE tr_phieubaogia_chitiet WHERE ID = @ID.
  // Hệ mới dùng soft-delete (deleted_at) cho bảng thật — chuẩn thay cho DELETE.
  return t.softDeleteWhere(sql`${t.text("id")} = ${args.id}`);
}
