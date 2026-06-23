/* Port TR_LENHCAPPHAT_HEAD_UPDATE — cập nhật header lệnh cấp phát.
   Nguồn: migration-plan/ui/proc-bodies/tr_lenhcapphat_head_update.sql
     UPDATE tr_lenhcapphat_head
     SET LoaiDonHang, LoaiCapPhat, MaDonDatHang, hoanthanh, vuotdinhmuc,
         active, nguoiduyet, ngayduyet, mahoso
     WHERE LenhCapPhatID = @LenhCapPhatID

   Dùng cho nút DQHF "Duyệt lệnh cấp phát" (bbiDuyetLCP): set nguoiduyet +
   ngayduyet (= đã duyệt, theo TR_LENHCAPPHAT_HEAD_GETBYACTIVE: nguoiduyet
   IS NOT NULL AND ngayduyet IS NOT NULL).

   ĐỘ LỆCH SO VỚI T-SQL (có chủ đích, fail-safe): proc gốc SET tất cả 9
   cột vô điều kiện (WinForm luôn nạp full record rồi update). Ở đây chỉ
   update field NÀO ĐƯỢC TRUYỀN (undefined → procTable bỏ qua) — để page
   chỉ cần gửi { lenh_cap_phat_id, nguoiduyet, ngayduyet } khi duyệt mà
   KHÔNG xoá trắng các cột còn lại. Truyền đủ field thì kết quả == T-SQL.
   Khoá theo lenhcapphatid — list emit field này ra state qua selectionEmits. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trLenhcapphatHeadUpdate(
  db: DB,
  companyId: string,
  args: {
    lenh_cap_phat_id: string;
    loaidonhang?: string | null;
    loaicapphat?: string | null;
    madondathang?: string | null;
    hoanthanh?: boolean | null;
    vuotdinhmuc?: boolean | null;
    active?: boolean | null;
    nguoiduyet?: string | null;
    ngayduyet?: string | null;
    mahoso?: string | null;
  },
): Promise<Array<{ updated: number; message: string }>> {
  if (!args.lenh_cap_phat_id) throw new Error("Thiếu lenh_cap_phat_id");

  // Chỉ gom field được truyền (undefined → bỏ) — partial update an toàn.
  const patch: Record<string, unknown> = {};
  for (const f of [
    "loaidonhang",
    "loaicapphat",
    "madondathang",
    "hoanthanh",
    "vuotdinhmuc",
    "active",
    "nguoiduyet",
    "ngayduyet",
    "mahoso",
  ] as const) {
    if (args[f] !== undefined) patch[f] = args[f];
  }
  if (Object.keys(patch).length === 0) {
    return [{ updated: 0, message: "Không có field nào để cập nhật" }];
  }

  const head = await procTable(db, companyId, "tr_lenhcapphat_head");
  const updated = await head.updateWhere(
    patch,
    sql`${head.text("lenhcapphatid")} = ${args.lenh_cap_phat_id}`,
  );
  return [
    {
      updated,
      message: updated > 0 ? "Đã cập nhật lệnh cấp phát" : "Không tìm thấy lệnh cấp phát",
    },
  ];
}
