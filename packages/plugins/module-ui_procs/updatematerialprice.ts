/* Port UpdateMaterialPrice — cập nhật đơn giá + nhà cung cấp vật tư.
   Nguồn: migration-plan/ui/proc-bodies/updatematerialprice.sql
   Ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   f_... hoặc ext của bảng thật, tự version/updated_at, guard mirror).
   T-SQL: WHERE ISNULL(idxuong, mavt) = @MaterialCode → COALESCE 2 biểu thức field.
   loaitien: T-SQL chỉ ghi đè khi tham số khác NULL/rỗng — JS quyết định trước,
   rỗng thì bỏ key khỏi patch (giữ nguyên giá trị hiện tại). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function updateMaterialPrice(
  db: DB,
  companyId: string,
  args: {
    material_code: string;
    price: number;
    loai_tien?: string | null;
    vendor_code: string;
    vendor_name: string;
  },
): Promise<Array<{ rows_updated: number }>> {
  if (!args.material_code) throw new Error("Thiếu material_code");
  if (args.price == null) throw new Error("Thiếu price");

  const t = await procTable(db, companyId, "tr_material");

  const patch: Record<string, unknown> = {
    dongia: args.price,
    mancc: args.vendor_code,
    tenncc: args.vendor_name,
  };
  // Chỉ cập nhật loaitien khi có giá trị (khác null/rỗng) — như CASE WHEN gốc
  if (args.loai_tien != null && args.loai_tien !== "") {
    patch.loaitien = args.loai_tien;
  }

  const updated = await t.updateWhere(
    patch,
    sql`COALESCE(${t.text("idxuong")}, ${t.text("mavt")}) = ${args.material_code}`,
  );

  return [{ rows_updated: updated }];
}
