/* Port TR_NHACC_INSERT2 — thêm nhà cung cấp.
   Nguồn: migration-plan/ui/proc-bodies/tr_nhacc_insert2.sql
   Ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   của bảng thật, tự version/updated_at/search_tsv, guard mirror).
   Semantic đổi: trả id uuid của row mới (id int nguồn không tồn tại). */
import type { DB } from "@erp-framework/server/db";
import { procTable } from "../src/proc-table";

export async function trNhaccInsert2(
  db: DB,
  companyId: string,
  args: {
    vendor_id: string;
    vendor_name: string;
    address: string;
    area?: string;
    phone: string;
    email: string;
    website: string;
    loaincc: number;
    create_by: string;
    create_date: Date | string;
    sotaikhoan?: string | null;
    tentaikhoan?: string | null;
    tennganhang?: string | null;
  },
): Promise<Array<{ id: string }>> {
  if (!args.vendor_id) throw new Error("Thiếu vendor_id");
  if (!args.vendor_name) throw new Error("Thiếu vendor_name");
  if (!args.create_by) throw new Error("Thiếu create_by");

  const t = await procTable(db, companyId, "tr_nhacc");
  const id = await t.insertRow({
    vendor_id: args.vendor_id,
    vendor_name: args.vendor_name,
    address: args.address,
    // T-SQL: @area nvarchar(50) = '' — default chuỗi rỗng
    area: args.area ?? "",
    phone: args.phone,
    email: args.email,
    website: args.website,
    loaincc: args.loaincc,
    create_by: args.create_by,
    create_date:
      args.create_date instanceof Date ? args.create_date.toISOString() : args.create_date,
    sotaikhoan: args.sotaikhoan ?? null,
    tentaikhoan: args.tentaikhoan ?? null,
    tennganhang: args.tennganhang ?? null,
  });

  return [{ id }];
}
