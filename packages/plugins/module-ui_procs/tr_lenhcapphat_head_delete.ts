/* Port TR_LENHCAPPHAT_HEAD_DELETE — huỷ lệnh cấp phát (soft cancel).
   Nguồn: migration-plan/ui/proc-bodies/tr_lenhcapphat_head_delete.sql
     UPDATE tr_lenhcapphat      SET active = 0 WHERE LenhCapPhatID = @id
     UPDATE tr_lenhcapphat_head SET active = 0 WHERE LenhCapPhatID = @id

   "Hủy lệnh cấp phát" KHÔNG xoá row — chỉ tắt cờ active trên CẢ dòng chi
   tiết (tr_lenhcapphat) lẫn header (tr_lenhcapphat_head). Mọi nơi đọc LCP
   live đều lọc active=1 (xem TR_LENHCAPPHAT_HEAD_GETBYACTIVE) nên row tắt
   active biến mất khỏi danh sách. active là bit nguồn → field bool → set
   false. Ghi qua procTable (guard mirror, đúng cột vật lý). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trLenhcapphatHeadDelete(
  db: DB,
  companyId: string,
  args: { lenh_cap_phat_id: string },
): Promise<Array<{ updated: number; message: string }>> {
  if (!args.lenh_cap_phat_id) throw new Error("Thiếu lenh_cap_phat_id");

  const lines = await procTable(db, companyId, "tr_lenhcapphat");
  const head = await procTable(db, companyId, "tr_lenhcapphat_head");

  const nLines = await lines.updateWhere(
    { active: false },
    sql`${lines.text("lenhcapphatid")} = ${args.lenh_cap_phat_id}`,
  );
  const nHead = await head.updateWhere(
    { active: false },
    sql`${head.text("lenhcapphatid")} = ${args.lenh_cap_phat_id}`,
  );

  const updated = nLines + nHead;
  return [
    { updated, message: nHead > 0 ? "Đã huỷ lệnh cấp phát" : "Không tìm thấy lệnh cấp phát" },
  ];
}
