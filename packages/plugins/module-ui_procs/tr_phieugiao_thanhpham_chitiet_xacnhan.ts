/* Port TR_PHIEUGIAO_THANHPHAM_CHITIET_XACNHAN — xác nhận 1 dòng chi tiết
   phiếu giao thành phẩm theo id (int):
   1. Đọc dòng chi tiết lấy phieugiao_id/madonhang/masp/mathung/soluong.
   2. Nếu xacnhan = true, proc gốc gọi 2 proc tồn kho thành phẩm (chưa port
      — xem TODO bên dưới).
   3. Set xacnhan + nguoixacnhan + ngayxacnhan = GETDATE().
   4. Proc gốc gọi tiếp AUTOFINISH cho phiếu giao (chưa port — TODO).
   Nguồn: migration-plan/ui/proc-bodies/tr_phieugiao_thanhpham_chitiet_xacnhan.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trPhieugiaoThanhphamChitietXacnhan(
  db: DB,
  companyId: string,
  args: { id: number; xacnhan: boolean; nguoixacnhan: string | null },
): Promise<Array<{ updated: number; phieugiao_id: number | null }>> {
  if (args.id == null) throw new Error("Thiếu id");

  // GETDATE() của proc gốc
  const ngayxacnhan = new Date().toISOString();

  const t = await procTable(db, companyId, "tr_phieugiao_thanhpham_chitiet");
  const [ct] = await t.listWhere(sql`${t.num("id")} = ${args.id}`, { limit: 1 });

  if (args.xacnhan) {
    // TODO: EXEC TR_TONKHO_THANHPHAM2_CREATE @madonhang, @masp, @mathung, @soluong
    //   — chưa port: tạo dòng tồn kho thành phẩm nếu chưa có
    //   (dữ liệu cần: ct.madonhang, ct.masp, ct.mathung, ct.soluong).
    // TODO: EXEC TR_TONKHO_THANHPHAM2_GIAODICH_INSERT 'IN', @madonhang, @masp,
    //   @mathung, @soluong, @ngayxacnhan — chưa port: ghi giao dịch nhập
    //   tồn kho thành phẩm.
  }

  const updated = await t.updateWhere(
    { xacnhan: args.xacnhan, nguoixacnhan: args.nguoixacnhan, ngayxacnhan },
    sql`${t.num("id")} = ${args.id}`,
  );

  // TODO: EXEC TR_PHIEUGIAO_THANHPHAM_AUTOFINISH @phieugiao_id — chưa port:
  //   tự đánh dấu phiếu giao hoàn thành khi mọi chi tiết đã xác nhận.

  const phieugiaoId = ct?.phieugiao_id == null ? null : Number(ct.phieugiao_id);
  return [{ updated, phieugiao_id: phieugiaoId }];
}
