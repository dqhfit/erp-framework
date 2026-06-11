/* Port TR_BAOCAO_FINAL_MUCKIEMTRA_DELETE2 — xoá 1 hình ảnh của mục kiểm tra
   báo cáo final; nếu mục không còn hình ảnh nào thì xoá luôn mục kiểm tra.
   Nguồn: migration-plan/ui/proc-bodies/tr_baocao_final_muckiemtra_delete2.sql

   2 bảng (đều có trong field-map):
   - tr_baocao_final_hinhanh    → item_id (text, uniqueidentifier nguồn)
                                  + image_id (number)
   - tr_baocao_final_muckiemtra → item_id (text)

   Hệ mới dùng soft-delete (deleted_at) thay cho DELETE của T-SQL; listWhere
   của procTable đã scope deleted_at IS NULL nên check "hết hình ảnh" vẫn
   đúng sau khi soft-delete. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trBaocaoFinalMuckiemtraDelete2(
  db: DB,
  companyId: string,
  args: {
    item_id: string;
    image_id: number;
  },
): Promise<{ deleted_hinhanh: number; deleted_muckiemtra: number }> {
  if (!args.item_id) throw new Error("Thiếu item_id");
  if (args.image_id == null) throw new Error("Thiếu image_id");

  // Bước 1: xoá hình ảnh theo item_id + image_id
  const hinhanh = await procTable(db, companyId, "tr_baocao_final_hinhanh");
  const deletedHinhanh = await hinhanh.softDeleteWhere(sql`
    ${hinhanh.text("item_id")} = ${args.item_id}
    AND ${hinhanh.num("image_id")} = ${args.image_id}
  `);

  // Bước 2: nếu item_id không còn hình ảnh nào → xoá mục kiểm tra
  let deletedMuckiemtra = 0;
  const remaining = await hinhanh.listWhere(sql`${hinhanh.text("item_id")} = ${args.item_id}`, {
    limit: 1,
  });
  if (remaining.length === 0) {
    const muckiemtra = await procTable(db, companyId, "tr_baocao_final_muckiemtra");
    deletedMuckiemtra = await muckiemtra.softDeleteWhere(
      sql`${muckiemtra.text("item_id")} = ${args.item_id}`,
    );
  }

  return { deleted_hinhanh: deletedHinhanh, deleted_muckiemtra: deletedMuckiemtra };
}
