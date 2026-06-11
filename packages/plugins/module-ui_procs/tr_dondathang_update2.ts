/* Port TR_DONDATHANG_UPDATE2 — cập nhật đơn đặt hàng theo maddh.
   Nguồn: migration-plan/ui/proc-bodies/tr_dondathang_update2.sql
   Ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   f_... hoặc ext của bảng thật, tự version/updated_at/search_tsv, guard mirror).
   Tham số @columnName của proc map sang field "columnname" (theo field-map).
   Proc gốc KHÔNG update create_by/create_date — giữ nguyên. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trDondathangUpdate2(
  db: DB,
  companyId: string,
  args: {
    maddh: string;
    tenddh: string | null;
    mancc: string | null;
    tenncc: string | null;
    loaidonhang: string | null;
    loaiddh: string | null;
    loaithanhtoan: number | null;
    ngaydat: string | null;
    ngaygiao: string | null;
    ngayyeucau: string | null;
    trangthai: string | null;
    pheduyet: string | null;
    donhang: string | null;
    lan_sua: number | null;
    ngayduyet: string | null;
    nguoiduyet: string | null;
    ngayky: string | null;
    nguoiky: string | null;
    isshowsign: boolean | null;
    update_by: string | null;
    update_date: string | null;
    active: boolean | null;
    kehoach_sanxuat: number | null;
    id_maddhmaddh: string | null;
    ghichu: string | null;
    chukytp: string | null;
    chukygd: string | null;
    chukynv: string | null;
    ngayky_nhanvien: string | null;
    column_name: string | null;
  },
): Promise<Array<Record<string, unknown>>> {
  if (!args.maddh) throw new Error("Thiếu maddh");

  const t = await procTable(db, companyId, "tr_dondathang");
  await t.updateWhere(
    {
      tenddh: args.tenddh,
      mancc: args.mancc,
      tenncc: args.tenncc,
      loaidonhang: args.loaidonhang,
      loaiddh: args.loaiddh,
      loaithanhtoan: args.loaithanhtoan,
      ngaydat: args.ngaydat,
      ngaygiao: args.ngaygiao,
      ngayyeucau: args.ngayyeucau,
      trangthai: args.trangthai,
      pheduyet: args.pheduyet,
      donhang: args.donhang,
      lan_sua: args.lan_sua,
      ngayduyet: args.ngayduyet,
      nguoiduyet: args.nguoiduyet,
      ngayky: args.ngayky,
      nguoiky: args.nguoiky,
      isshowsign: args.isshowsign,
      update_by: args.update_by,
      update_date: args.update_date,
      active: args.active,
      kehoach_sanxuat: args.kehoach_sanxuat,
      id_maddhmaddh: args.id_maddhmaddh,
      ghichu: args.ghichu,
      chukytp: args.chukytp,
      chukygd: args.chukygd,
      chukynv: args.chukynv,
      ngayky_nhanvien: args.ngayky_nhanvien,
      columnname: args.column_name,
    },
    sql`${t.text("maddh")} = ${args.maddh}`,
  );

  return [];
}
