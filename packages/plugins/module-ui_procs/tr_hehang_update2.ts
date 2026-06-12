/* Port TR_HEHANG_Update2 — cập nhật hệ hàng theo id (int) + đồng bộ
   tên hệ hàng mới sang 4 bảng tham chiếu (tr_sanpham, tr_banve,
   tr_sanpham_nhamay, tr_nguoiphutrach_kythuat) đang trỏ tên cũ.
   Nguồn: migration-plan/ui/proc-bodies/tr_hehang_update2.sql
   Proc gốc đọc @oldValue = tenhh trước rồi mới UPDATE — giữ đúng thứ tự. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trHehangUpdate2(
  db: DB,
  companyId: string,
  args: {
    id: number;
    tenhh: string;
    ghichu?: string | null;
    khachhang?: string | null;
    heso?: number | null; // proc gốc default 1.0
  },
): Promise<Array<{ updated: number }>> {
  if (!args.id) throw new Error("Thiếu id");

  const tHehang = await procTable(db, companyId, "tr_hehang");

  // Lấy tên hệ hàng CŨ trước khi update (proc gốc: SELECT @oldValue = tenhh ...)
  const [cur] = await tHehang.listWhere(sql`${tHehang.num("id")} = ${args.id}`, { limit: 1 });
  const oldValue = cur?.tenhh == null ? null : String(cur.tenhh);

  // UPDATE tr_hehang SET ghichu, tenhh, khachhang, heso WHERE id = @id
  const updated = await tHehang.updateWhere(
    {
      tenhh: args.tenhh,
      ghichu: args.ghichu ?? null,
      khachhang: args.khachhang ?? null,
      heso: args.heso ?? 1.0,
    },
    sql`${tHehang.num("id")} = ${args.id}`,
  );

  // Cascade: đổi tên hệ hàng ở 4 bảng tham chiếu. Proc gốc so sánh
  // hehang = @oldValue — oldValue NULL thì WHERE không khớp gì → skip.
  if (oldValue != null && oldValue !== args.tenhh) {
    for (const name of [
      "tr_sanpham",
      "tr_banve",
      "tr_sanpham_nhamay",
      "tr_nguoiphutrach_kythuat",
    ]) {
      const t = await procTable(db, companyId, name);
      await t.updateWhere({ hehang: args.tenhh }, sql`${t.text("hehang")} = ${oldValue}`);
    }
  }

  return [{ updated }];
}
