/* Port TR_THONGTIN_SANPHAM_TEM_DELETEALL — xoá toàn bộ thông tin tem
   của 1 bộ sản phẩm theo idbosanpham (uniqueidentifier nguồn).
   Hệ mới dùng soft-delete (deleted_at) thay cho DELETE của T-SQL.
   TÌNH TRẠNG DỮ LIỆU: entity tr_thongtin_sanpham_tem đã có trên prod
   nhưng 0 rows (bảng bị skip import vì ảnh nhúng) — proc vẫn chạy đúng,
   chỉ là chưa có dữ liệu để xoá cho tới khi import lại.
   Nguồn: migration-plan/ui/proc-bodies/tr_thongtin_sanpham_tem_deleteall.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trThongtinSanphamTemDeleteall(
  db: DB,
  companyId: string,
  args: {
    idbosanpham: string;
  },
): Promise<number> {
  if (!args.idbosanpham) throw new Error("Thiếu idbosanpham");

  const t = await procTable(db, companyId, "tr_thongtin_sanpham_tem");
  return t.softDeleteWhere(sql`${t.text("idbosanpham")} = ${args.idbosanpham}`);
}
