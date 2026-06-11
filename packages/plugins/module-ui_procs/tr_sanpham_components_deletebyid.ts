/* Port TR_SANPHAM_COMPONENTS_DELETEBYID — xoá component của sản phẩm theo id.
   Nguồn: migration-plan/ui/proc-bodies/tr_sanpham_components_deletebyid.sql

   Bảng tr_sanpham_components CHƯA migrate sang PG — proc sẽ throw
   "entity không tồn tại" khi gọi, cần đưa bảng vào scope migrate trước.
   (procTable tự fail-fast với message rõ.) */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trSanphamComponentsDeletebyid(
  db: DB,
  companyId: string,
  args: { id: number },
): Promise<number> {
  if (!args.id) throw new Error("Thiếu id");

  const t = await procTable(db, companyId, "tr_sanpham_components");
  // Proc gốc: DELETE tr_sanpham_components WHERE id = @id (PK nguồn int).
  // Hệ mới dùng soft-delete (deleted_at) cho bảng thật — chuẩn thay cho DELETE.
  return t.softDeleteWhere(sql`${t.num("id")} = ${args.id}`);
}
