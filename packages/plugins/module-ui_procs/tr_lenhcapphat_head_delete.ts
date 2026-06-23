/* Port TR_LENHCAPPHAT_HEAD_DELETE — huỷ lệnh cấp phát (soft cancel).
   Nguồn: migration-plan/ui/proc-bodies/tr_lenhcapphat_head_delete.sql
     UPDATE tr_lenhcapphat      SET active = 0 WHERE LenhCapPhatID = @id
     UPDATE tr_lenhcapphat_head SET active = 0 WHERE LenhCapPhatID = @id

   "Hủy lệnh cấp phát" KHÔNG xoá row — soft-delete (deleted_at) cả dòng chi
   tiết (tr_lenhcapphat) lẫn header (tr_lenhcapphat_head). Trước khi xoá kiểm
   tra 3 điều kiện chặn: đã hoàn thành, đã duyệt, đã cấp phát vật tư. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trLenhcapphatHeadDelete(
  db: DB,
  companyId: string,
  args: { lenh_cap_phat_id?: string; _id?: string },
): Promise<Array<{ updated: number; message: string }>> {
  if (!args.lenh_cap_phat_id && !args._id) throw new Error("Thiếu lenh_cap_phat_id hoặc _id");

  return db.transaction(async (tx) => {
    const lines = await procTable(tx, companyId, "tr_lenhcapphat");
    const head = await procTable(tx, companyId, "tr_lenhcapphat_head");

    // Tìm header theo UUID (_id) hoặc business key (lenh_cap_phat_id).
    const headRows = args._id
      ? await head.listWhere(sql`id = ${args._id}::uuid`)
      : await head.listWhere(sql`${head.text("lenhcapphatid")} = ${args.lenh_cap_phat_id}`);

    const h = headRows[0];
    if (!h) throw new Error("Không tìm thấy lệnh cấp phát.");

    const lenhCapPhatId = h.lenhcapphatid as string;

    // Guard 1: Đã hoàn thành — không cho xoá.
    const hoanthanh = h.hoanthanh;
    if (hoanthanh === true || hoanthanh === "true") {
      throw new Error("LCP đã hoàn thành, không thể xoá.");
    }

    // Guard 2: Đã duyệt → đang trong luồng cấp phát — không cho xoá.
    if (h.nguoiduyet) {
      throw new Error("LCP đã được duyệt (đang cấp phát vật tư), không thể xoá.");
    }

    // Guard 3: Đã cấp phát vật tư thực tế (soluong_daphat > 0).
    const detailRows = await lines.listWhere(
      sql`${lines.text("lenhcapphatid")} = ${lenhCapPhatId}`,
    );
    const hasDispensed = detailRows.some((r) => {
      const v = r.soluong_daphat;
      return v != null && Number(v) > 0;
    });
    if (hasDispensed) {
      throw new Error("Đã cấp phát vật tư, không thể xoá lệnh cấp phát.");
    }

    // Soft-delete cả lines lẫn head (deleted_at = now()).
    const nLines = await lines.softDeleteWhere(
      sql`${lines.text("lenhcapphatid")} = ${lenhCapPhatId}`,
    );
    const nHead = await head.softDeleteWhere(sql`${head.text("lenhcapphatid")} = ${lenhCapPhatId}`);

    const updated = nLines + nHead;
    return [
      { updated, message: nHead > 0 ? "Đã huỷ lệnh cấp phát" : "Không tìm thấy lệnh cấp phát" },
    ];
  });
}
