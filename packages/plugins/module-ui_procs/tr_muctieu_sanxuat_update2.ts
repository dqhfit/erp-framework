/* Port TR_MUCTIEU_SANXUAT_UPDATE2 — cập nhật 1 dòng mục tiêu sản xuất
   kèm optimistic concurrency theo RowVer (WHERE id = @id AND RowVer =
   @RowVer — RowVer lệch thì updated = 0, caller hiểu là dữ liệu đã bị
   người khác sửa). heso tính lại trong proc gốc:
     heso = 0 khi songuoi = 0 hoặc sogio = 0, ngược lại muctieu / songuoi / sogio.
   Các tham số ngaythang/ngaytao/nguoitao có trong chữ ký T-SQL nhưng
   proc gốc KHÔNG dùng — giữ optional để khớp form gọi.
   TÌNH TRẠNG DỮ LIỆU: entity tr_muctieu_sanxuat đã có trên prod nhưng
   0 rows (bảng bị skip import vì treo) — proc vẫn chạy đúng khi có dữ liệu.
   Nguồn: migration-plan/ui/proc-bodies/tr_muctieu_sanxuat_update2.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trMuctieuSanxuatUpdate2(
  db: DB,
  companyId: string,
  args: {
    id: string;
    ngaythang?: string;
    macongdoan: string;
    donhang: string;
    hehang: string;
    muctieu: number;
    songuoi?: number;
    sogio?: number;
    ngaytao?: string;
    nguoitao?: string;
    ngaysua: string;
    nguoisua: string;
    rowver: string;
  },
): Promise<Array<{ updated: number }>> {
  if (!args.id) throw new Error("Thiếu id");
  if (args.rowver == null) throw new Error("Thiếu rowver");
  if (args.muctieu == null || Number.isNaN(Number(args.muctieu))) {
    throw new Error("Thiếu muctieu");
  }

  // Default theo chữ ký T-SQL: @songuoi int = 0, @sogio float = 8
  const songuoi = args.songuoi ?? 0;
  const sogio = args.sogio ?? 8;
  const heso = songuoi === 0 || sogio === 0 ? 0 : args.muctieu / songuoi / sogio;

  const t = await procTable(db, companyId, "tr_muctieu_sanxuat");
  const updated = await t.updateWhere(
    {
      macongdoan: args.macongdoan,
      donhang: args.donhang,
      hehang: args.hehang,
      muctieu: args.muctieu,
      songuoi,
      sogio,
      heso,
      ngaysua: args.ngaysua,
      nguoisua: args.nguoisua,
    },
    sql`${t.text("id")} = ${args.id} AND ${t.text("rowver")} = ${args.rowver}`,
  );
  return [{ updated }];
}
