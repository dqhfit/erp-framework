/* Port TR_TRANGTHAI_SANXUAT_XACNHAN — xác nhận giao hàng trạng thái sản xuất.
   Nguồn: KHÔNG có file migration-plan/ui/proc-bodies/tr_trangthai_sanxuat_xacnhan.sql
   — giữ nguyên logic từ bản port trước (đã đối chiếu T-SQL gốc khi port lần đầu).
   Đọc/ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   f_... hoặc ext của bảng thật, tự version/updated_at, guard mirror).
   Lưu ý: T-SQL gốc có bug @congdoan = @congdoan (tự gán, không đọc từ bảng);
   block IF dùng @congdoan đã bị comment out nên không ảnh hưởng — bỏ qua ở đây.
   mact = '000' (cụm): sokhoi lấy m3_tc của tr_sanpham theo masp1;
   ngược lại sokhoi = dayy*rong*dai*soluong/1e9. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trTrangThaiSanXuatXacNhan(
  db: DB,
  companyId: string,
  args: {
    id: string;
    soluong: number;
    ngaygiao: Date;
    nguoinhan: string;
  },
): Promise<void> {
  if (!args.id) throw new Error("Thiếu id");
  if (args.soluong == null) throw new Error("Thiếu soluong");
  if (!args.ngaygiao) throw new Error("Thiếu ngaygiao");
  if (!args.nguoinhan) throw new Error("Thiếu nguoinhan");

  const ngaygiao =
    args.ngaygiao instanceof Date
      ? args.ngaygiao.toISOString()
      : new Date(args.ngaygiao).toISOString();

  const t = await procTable(db, companyId, "tr_trangthai_sanxuat");
  const where = sql`${t.text("id")} = ${args.id}`;

  // Đọc thông tin dòng cần xác nhận (mact, masp1, kích thước)
  const [row] = await t.listWhere(where, { limit: 1 });
  if (!row) throw new Error("Không tìm thấy bản ghi tr_trangthai_sanxuat");

  let sokhoi: number;
  if (row.mact === "000") {
    // Dòng cụm — lấy số khối tiêu chuẩn m3_tc từ sản phẩm theo masp1
    const tsp = await procTable(db, companyId, "tr_sanpham");
    const [sp] = await tsp.listWhere(sql`${tsp.text("masp")} = ${row.masp1 ?? null}`, { limit: 1 });
    const m3tc = Number(sp?.m3_tc);
    sokhoi = Number.isFinite(m3tc) ? m3tc : 0;
  } else {
    const dayy = Number(row.dayy) || 0;
    const rong = Number(row.rong) || 0;
    const dai = Number(row.dai) || 0;
    sokhoi = (dayy * rong * dai * args.soluong) / 1_000_000_000;
  }

  await t.updateWhere(
    {
      ngaygiao,
      nguoinhan: args.nguoinhan,
      soluong: args.soluong,
      sokhoi,
    },
    where,
  );
}
