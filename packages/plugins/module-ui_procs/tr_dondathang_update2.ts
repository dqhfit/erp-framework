import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

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

  // columnName trong proc gốc là tên cột động — ánh xạ sang cột typed `columnname`
  const r = await db.execute<Record<string, unknown>>(sql`
    UPDATE tr_dondathang
    SET
      tenddh           = ${args.tenddh},
      mancc            = ${args.mancc},
      tenncc           = ${args.tenncc},
      loaidonhang      = ${args.loaidonhang},
      loaiddh          = ${args.loaiddh},
      loaithanhtoan    = ${args.loaithanhtoan},
      ngaydat          = ${args.ngaydat}::date,
      ngaygiao         = ${args.ngaygiao}::date,
      ngayyeucau       = ${args.ngayyeucau}::date,
      trangthai        = ${args.trangthai},
      pheduyet         = ${args.pheduyet},
      donhang          = ${args.donhang},
      lan_sua          = ${args.lan_sua},
      ngayduyet        = ${args.ngayduyet}::timestamptz,
      nguoiduyet       = ${args.nguoiduyet},
      ngayky           = ${args.ngayky}::timestamptz,
      nguoiky          = ${args.nguoiky},
      isshowsign       = ${args.isshowsign},
      update_by        = ${args.update_by},
      update_date      = ${args.update_date}::timestamptz,
      active           = ${args.active},
      kehoach_sanxuat  = ${args.kehoach_sanxuat},
      id_maddhmaddh    = ${args.id_maddhmaddh},
      ghichu           = ${args.ghichu},
      chukytp          = ${args.chukytp},
      chukygd          = ${args.chukygd},
      chukynv          = ${args.chukynv},
      ngayky_nhanvien  = ${args.ngayky_nhanvien}::timestamptz,
      columnname       = ${args.column_name},
      updated_at       = now()
    WHERE maddh = ${args.maddh}
      AND company_id = ${companyId}
      AND deleted_at IS NULL
  `);

  return r as unknown as Array<Record<string, unknown>>;
}
