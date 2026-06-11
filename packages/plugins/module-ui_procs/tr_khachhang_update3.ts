import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

export async function trKhachhangUpdate3(
  db: DB,
  companyId: string,
  args: {
    customer_id: string;
    customer_name: string;
    address?: string | null;
    area?: string | null;
    phone?: string | null;
    fax?: string | null;
    email?: string | null;
    website?: string | null;
    director?: string | null;
    merchandiser?: string | null;
    merchandiser_phone?: string | null;
    merchandiser_mail?: string | null;
    ngaylamviec?: Date | string | null;
    bank_id?: string | null;
    taxcode?: string | null;
    active?: boolean | null;
    customer_type?: string | null;
    customer_type_name?: string | null;
  },
): Promise<Array<Record<string, never>>> {
  if (!args.customer_id) throw new Error("Thiếu customer_id");

  await db.execute(sql`
    UPDATE tr_khachhang
    SET
      customer_name      = ${args.customer_name},
      address            = ${args.address ?? null},
      area               = ${args.area ?? null},
      phone              = ${args.phone ?? null},
      fax                = ${args.fax ?? null},
      email              = ${args.email ?? null},
      website            = ${args.website ?? null},
      director           = ${args.director ?? null},
      merchandiser       = ${args.merchandiser ?? null},
      merchandiser_phone = ${args.merchandiser_phone ?? null},
      merchandiser_mail  = ${args.merchandiser_mail ?? null},
      ngaylamviec        = ${args.ngaylamviec ?? null},
      bank_id            = ${args.bank_id ?? null},
      taxcode            = ${args.taxcode ?? null},
      active             = ${args.active ?? null},
      customer_type      = ${args.customer_type ?? null},
      customer_type_name = ${args.customer_type_name ?? null},
      updated_at         = now()
    WHERE company_id = ${companyId}
      AND customer_id = ${args.customer_id}
      AND deleted_at IS NULL
  `);

  return [];
}
