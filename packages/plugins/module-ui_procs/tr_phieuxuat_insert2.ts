import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

export async function trPhieuxuatInsert2(
  db: DB,
  companyId: string,
  args: {
    sopx: string;
    loaiphieu: number;
    lenhcapphat: string;
    donhang: string;
    makho: string;
    nguoinhan: string;
    ghichu: string;
    nguoitao: string;
    ngaytao: string;
    active: boolean;
    nguoixacnhan?: string | null;
    ngayxacnhan?: string | null;
    xacnhan?: boolean | null;
    // @IsXuat bit = 1 trong T-SQL — default true nếu không truyền
    is_xuat?: boolean | null;
    ngayxuat?: string | null;
    reftype?: number | null;
    phieuyeucau?: string | null;
    maddh?: string | null;
    mucdich?: number | null;
  },
): Promise<Array<{ id: string }>> {
  if (!args.sopx) throw new Error("Thiếu sopx");

  const r = await db.execute<{ id: string }>(sql`
    INSERT INTO tr_phieuxuat (
      id,
      company_id,
      sopx,
      loaiphieu,
      lenhcapphat,
      donhang,
      makho,
      nguoinhan,
      ghichu,
      nguoitao,
      ngaytao,
      active,
      nguoixacnhan,
      ngayxacnhan,
      xacnhan,
      isxuat,
      ngayxuat,
      reftype,
      phieuyeucau,
      maddh,
      mucdich,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      ${companyId},
      ${args.sopx},
      ${args.loaiphieu},
      ${args.lenhcapphat},
      ${args.donhang},
      ${args.makho},
      ${args.nguoinhan},
      ${args.ghichu},
      ${args.nguoitao},
      ${args.ngaytao},
      ${args.active},
      ${args.nguoixacnhan ?? null},
      ${args.ngayxacnhan ?? null},
      ${args.xacnhan ?? null},
      ${args.is_xuat ?? true},
      ${args.ngayxuat ?? null},
      ${args.reftype ?? null},
      ${args.phieuyeucau ?? null},
      ${args.maddh ?? null},
      ${args.mucdich ?? null},
      now(),
      now()
    )
    RETURNING id
  `);

  return r as unknown as Array<{ id: string }>;
}
