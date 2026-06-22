/* Port TR_LENHCAPPHAT_HEAD_SETFINISH — đánh dấu lệnh cấp phát hoàn thành.
   Nguồn: migration-plan/ui/proc-bodies/tr_lenhcapphat_head_setfinish.sql
     UPDATE tr_lenhcapphat_head SET hoanthanh = @hoanthanh
     WHERE LenhCapPhatID = @LenhCapPhatID

   Nút DQHF "Đánh dấu hoàn thành" (bbiHoanThanh) gọi proc này với
   @hoanthanh = 1. Ghi qua procTable (đọc meta.storage lúc runtime, đúng
   cột vật lý bảng thật, guard mirror). Khoá theo lenhcapphatid (chuỗi
   nghiệp vụ) — list emit field này ra state qua selectionEmits. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trLenhcapphatHeadSetfinish(
  db: DB,
  companyId: string,
  args: { lenh_cap_phat_id: string; hoanthanh?: boolean },
): Promise<Array<{ updated: number; message: string }>> {
  if (!args.lenh_cap_phat_id) throw new Error("Thiếu lenh_cap_phat_id");
  // @hoanthanh bit — nút "Đánh dấu hoàn thành" mặc định set 1 (true).
  const hoanthanh = args.hoanthanh ?? true;

  const head = await procTable(db, companyId, "tr_lenhcapphat_head");
  const updated = await head.updateWhere(
    { hoanthanh },
    sql`${head.text("lenhcapphatid")} = ${args.lenh_cap_phat_id}`,
  );
  return [
    { updated, message: updated > 0 ? "Đã đánh dấu hoàn thành" : "Không tìm thấy lệnh cấp phát" },
  ];
}
