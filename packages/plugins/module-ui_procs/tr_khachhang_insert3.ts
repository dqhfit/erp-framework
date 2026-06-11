/* Port TR_KHACHHANG_INSERT3 — thêm khách hàng nếu chưa tồn tại theo customer_id.
   Nguồn: migration-plan/ui/proc-bodies/tr_khachhang_insert3.sql
   Ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   của bảng thật, tự version/updated_at/search_tsv, guard mirror).
   Semantic đổi: @id OUTPUT int (SCOPE_IDENTITY) của nguồn không tồn tại cho
   row mới — trả id uuid của row (mới insert hoặc row tồn tại sẵn). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trKhachhangInsert3(
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
    ngaylamviec?: string | null;
    create_by?: string | null;
    create_date?: string | null;
    bank_id?: string | null;
    taxcode?: string | null;
    active?: boolean | null;
    customer_type?: string | null;
    customer_type_name?: string | null;
  },
): Promise<Array<{ id: string }>> {
  if (!args.customer_id) throw new Error("Thiếu customer_id");
  if (!args.customer_name) throw new Error("Thiếu customer_name");

  const t = await procTable(db, companyId, "tr_khachhang");

  // Proc gốc: IF NOT EXISTS (... WHERE customer_id = @customer_id)
  const existing = await t.listWhere(sql`${t.text("customer_id")} = ${args.customer_id}`, {
    limit: 1,
  });
  const found = existing[0];
  if (found) {
    // Đã tồn tại — nhánh ELSE proc gốc trả id hiện có (ở đây là uuid row)
    return [{ id: String(found._id) }];
  }

  const id = await t.insertRow({
    customer_id: args.customer_id,
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
    ngaylamviec: args.ngaylamviec ?? null,
    create_by: args.create_by ?? null,
    create_date: args.create_date ?? null,
    bank_id: args.bank_id ?? null,
    taxcode: args.taxcode ?? null,
    active: args.active ?? null,
    customer_type: args.customer_type ?? null,
    customer_type_name: args.customer_type_name ?? null,
  });

  return [{ id }];
}
