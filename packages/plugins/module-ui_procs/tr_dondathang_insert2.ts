import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

export async function trDondathangInsert2(
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
    macongty?: string | null;
  },
): Promise<Array<{ id: string }>> {
  if (!args.maddh) throw new Error("Thiếu maddh");

  const r = await db.execute<{ id: string }>(sql`
    INSERT INTO tr_dondathang (
      id,
      company_id,
      maddh,
      tenddh,
      mancc,
      tenncc,
      loaidonhang,
      loaiddh,
      loaithanhtoan,
      ngaydat,
      ngaygiao,
      ngayyeucau,
      trangthai,
      pheduyet,
      donhang,
      lan_sua,
      ngayduyet,
      nguoiduyet,
      ngayky,
      nguoiky,
      isshowsign,
      create_by,
      create_date,
      update_by,
      update_date,
      active,
      kehoach_sanxuat,
      id_maddhmaddh,
      ghichu,
      chukytp,
      chukygd,
      chukynv,
      ngayky_nhanvien,
      mahoso,
      macongty,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      ${companyId},
      ${args.maddh},
      ${args.tenddh ?? null},
      ${args.mancc ?? null},
      ${args.tenncc ?? null},
      ${args.loaidonhang ?? null},
      ${args.loaiddh ?? null},
      ${args.loaithanhtoan ?? null},
      ${args.ngaydat ?? null},
      ${args.ngaygiao ?? null},
      ${args.ngayyeucau ?? null},
      ${args.trangthai ?? null},
      ${args.pheduyet ?? null},
      ${args.donhang ?? null},
      ${args.lan_sua ?? null},
      ${args.ngayduyet ?? null},
      ${args.nguoiduyet ?? null},
      ${args.ngayky ?? null},
      ${args.nguoiky ?? null},
      ${args.isshowsign ?? null},
      ${args.create_by ?? null},
      ${args.create_date ?? null},
      ${args.update_by ?? null},
      ${args.update_date ?? null},
      ${args.active ?? null},
      ${args.kehoach_sanxuat ?? null},
      ${args.id_maddhmaddh ?? null},
      ${args.ghichu ?? null},
      ${args.chukytp ?? null},
      ${args.chukygd ?? null},
      ${args.chukynv ?? null},
      ${args.ngayky_nhanvien ?? null},
      ${args.mahoso ?? null},
      ${args.macongty ?? null},
      now(),
      now()
    )
    RETURNING id
  `);

  return r as unknown as Array<{ id: string }>;
}
