/* Port TR_KHACHHANG_UPDATE3 — cập nhật khách hàng theo customer_id.
   Nguồn: migration-plan/ui/proc-bodies/tr_khachhang_update3.sql
   Ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   f_... hoặc ext của bảng thật, tự version/updated_at/search_tsv, guard mirror).
   bank_id nguồn là uniqueidentifier nhưng vẫn là FIELD text — gán thẳng giá trị.
   Proc gốc KHÔNG update create_by/create_date — giữ nguyên. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

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

  const t = await procTable(db, companyId, "tr_khachhang");
  await t.updateWhere(
    {
      customer_name: args.customer_name,
      address: args.address ?? null,
      area: args.area ?? null,
      phone: args.phone ?? null,
      fax: args.fax ?? null,
      email: args.email ?? null,
      website: args.website ?? null,
      director: args.director ?? null,
      merchandiser: args.merchandiser ?? null,
      merchandiser_phone: args.merchandiser_phone ?? null,
      merchandiser_mail: args.merchandiser_mail ?? null,
      ngaylamviec:
        args.ngaylamviec instanceof Date
          ? args.ngaylamviec.toISOString()
          : (args.ngaylamviec ?? null),
      bank_id: args.bank_id ?? null,
      taxcode: args.taxcode ?? null,
      active: args.active ?? null,
      customer_type: args.customer_type ?? null,
      customer_type_name: args.customer_type_name ?? null,
    },
    sql`${t.text("customer_id")} = ${args.customer_id}`,
  );

  return [];
}
