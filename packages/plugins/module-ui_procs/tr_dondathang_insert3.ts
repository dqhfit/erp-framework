/* Port TR_DONDATHANG_INSERT3 — thêm đơn đặt hàng (biến thể có sophieu_dexuat
   + macongty so với INSERT2). Trả uuid row mới. Các khối comment-out trong
   proc gốc (ép trạng thái theo user) giữ nguyên là không port.
   Nguồn: proc-bodies/tr_dondathang_insert3.sql */
import type { DB } from "@erp-framework/server/db";
import { procTable } from "../src/proc-table";

export async function trDondathangInsert3(
  db: DB,
  companyId: string,
  args: {
    maddh: string;
    tenddh?: string | null;
    mancc?: string | null;
    tenncc?: string | null;
    loaidonhang?: string | null;
    loaiddh?: string | null;
    loaithanhtoan?: number | null;
    ngaydat?: string | null;
    ngaygiao?: string | null;
    ngayyeucau?: string | null;
    trangthai?: string | null;
    pheduyet?: string | null;
    donhang?: string | null;
    lan_sua?: number | null;
    ngayduyet?: string | null;
    nguoiduyet?: string | null;
    ngayky?: string | null;
    nguoiky?: string | null;
    isshowsign?: boolean | null;
    create_by?: string | null;
    create_date?: string | null;
    update_by?: string | null;
    update_date?: string | null;
    active?: boolean | null;
    kehoach_sanxuat?: number | null;
    id_maddhmaddh?: string | null;
    ghichu?: string | null;
    chukytp?: string | null;
    chukygd?: string | null;
    chukynv?: string | null;
    ngayky_nhanvien?: string | null;
    mahoso?: string | null;
    sophieu_dexuat?: string | null;
    macongty?: string | null;
  },
): Promise<Array<{ id: string }>> {
  if (!args.maddh) throw new Error("Thiếu maddh");

  const t = await procTable(db, companyId, "tr_dondathang");
  const id = await t.insertRow({
    maddh: args.maddh,
    tenddh: args.tenddh ?? null,
    mancc: args.mancc ?? null,
    tenncc: args.tenncc ?? null,
    loaidonhang: args.loaidonhang ?? null,
    loaiddh: args.loaiddh ?? null,
    loaithanhtoan: args.loaithanhtoan ?? null,
    ngaydat: args.ngaydat ?? null,
    ngaygiao: args.ngaygiao ?? null,
    ngayyeucau: args.ngayyeucau ?? null,
    trangthai: args.trangthai ?? null,
    pheduyet: args.pheduyet ?? null,
    donhang: args.donhang ?? null,
    lan_sua: args.lan_sua ?? null,
    ngayduyet: args.ngayduyet ?? null,
    nguoiduyet: args.nguoiduyet ?? null,
    ngayky: args.ngayky ?? null,
    nguoiky: args.nguoiky ?? null,
    isshowsign: args.isshowsign ?? null,
    create_by: args.create_by ?? null,
    create_date: args.create_date ?? null,
    update_by: args.update_by ?? null,
    update_date: args.update_date ?? null,
    active: args.active ?? null,
    kehoach_sanxuat: args.kehoach_sanxuat ?? null,
    id_maddhmaddh: args.id_maddhmaddh ?? null,
    ghichu: args.ghichu ?? null,
    chukytp: args.chukytp ?? null,
    chukygd: args.chukygd ?? null,
    chukynv: args.chukynv ?? null,
    ngayky_nhanvien: args.ngayky_nhanvien ?? null,
    mahoso: args.mahoso ?? null,
    sophieu_dexuat: args.sophieu_dexuat ?? null,
    macongty: args.macongty ?? null,
  });
  return [{ id }];
}
