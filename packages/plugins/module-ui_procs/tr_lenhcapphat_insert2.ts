import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

export async function trLenhcapphatInsert2(
  db: DB,
  companyId: string,
  args: {
    lenh_cap_phat_id: string;
    loai_don_hang?: string | null;
    loai_cap_phat?: string | null;
    ma_don_dat_hang?: string | null;
    ma_don_hang?: string | null;
    master_code?: string | null;
    masp?: string | null;
    mavt?: string | null;
    mota?: string | null;
    quycach?: string | null;
    mausac?: string | null;
    soluong_donhang?: number | null;
    soluong?: number | null;
    soluong_daphat?: number | null;
    soluong_conlai?: number | null;
    dvt?: string | null;
    nhom?: string | null;
    nguoitao?: string | null;
    ngaytao?: Date | string | null;
    capphat?: boolean | null;
    active?: boolean | null;
    ghichu?: string | null;
    vuotdinhmuc?: boolean | null;
  },
): Promise<Array<{ id: number }>> {
  if (!args.lenh_cap_phat_id) throw new Error("Thiếu lenh_cap_phat_id");

  const r = await db.execute<{ id: number }>(sql`
    INSERT INTO tr_lenhcapphat
    (
      company_id,
      lenhcapphatid,
      loaidonhang,
      loaicapphat,
      madondathang,
      madonhang,
      master_code,
      masp,
      mavt,
      mota,
      quycach,
      mausac,
      soluong_donhang,
      soluong,
      soluong_daphat,
      soluong_conlai,
      dvt,
      nhom,
      nguoitao,
      ngaytao,
      capphat,
      active,
      ghichu,
      vuotdinhmuc,
      created_at,
      updated_at
    )
    VALUES
    (
      ${companyId},
      ${args.lenh_cap_phat_id},
      ${args.loai_don_hang ?? null},
      ${args.loai_cap_phat ?? null},
      ${args.ma_don_dat_hang ?? null},
      ${args.ma_don_hang ?? null},
      ${args.master_code ?? null},
      ${args.masp ?? null},
      ${args.mavt ?? null},
      ${args.mota ?? null},
      ${args.quycach ?? null},
      ${args.mausac ?? null},
      ${args.soluong_donhang ?? null},
      ${args.soluong ?? null},
      ${args.soluong_daphat ?? null},
      ${args.soluong_conlai ?? null},
      ${args.dvt ?? null},
      ${args.nhom ?? null},
      ${args.nguoitao ?? null},
      ${args.ngaytao ?? null},
      ${args.capphat ?? null},
      ${args.active ?? null},
      ${args.ghichu ?? null},
      ${args.vuotdinhmuc ?? null},
      now(),
      now()
    )
    RETURNING id
  `);

  return r as unknown as Array<{ id: number }>;
}
