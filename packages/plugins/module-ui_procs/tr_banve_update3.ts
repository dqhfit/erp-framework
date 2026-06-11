import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

export async function trBanveUpdate3(
  db: DB,
  companyId: string,
  args: {
    id: number;
    masp: string;
    tensp: string;
    khachhang: string;
    hehang: string;
    filepath: string;
    seq1: string;
    seq2: string;
    banve_donggoi: boolean;
    banve_govan: boolean;
    phanloai: string;
    update_by: string;
    update_date: Date;
    active: boolean;
  },
): Promise<void> {
  if (!args.id) throw new Error("Thiếu id");

  // UPDATE thẳng bảng thật tr_banve, scope theo company_id để tránh cross-tenant
  await db.execute(sql`
    UPDATE tr_banve
    SET
      masp         = ${args.masp},
      tensp        = ${args.tensp},
      khachhang    = ${args.khachhang},
      hehang       = ${args.hehang},
      filepath     = ${args.filepath},
      seq1         = ${args.seq1},
      seq2         = ${args.seq2},
      banve_donggoi = ${args.banve_donggoi},
      banve_govan  = ${args.banve_govan},
      phanloai     = ${args.phanloai},
      update_by    = ${args.update_by},
      update_date  = ${args.update_date},
      active       = ${args.active},
      updated_at   = now()
    WHERE id = ${args.id}
      AND company_id = ${companyId}
      AND deleted_at IS NULL
  `);
}
