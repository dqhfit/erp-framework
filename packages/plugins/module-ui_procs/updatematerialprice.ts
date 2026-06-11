import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

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

  // COALESCE(idxuong, mavt) = @MaterialCode — giữ nguyên logic fallback của T-SQL gốc:
  // tr_material dùng idxuong làm mã chính nếu có, ngược lại dùng mavt.
  //
  // loaitien chỉ cập nhật khi tham số không rỗng; nếu rỗng/null thì giữ giá trị
  // hiện tại trong bảng — dùng COALESCE(NULLIF(..., ''), loaitien) thay cho
  // CASE WHEN IS NULL OR = '' của T-SQL gốc.
  const loaiTien = args.loai_tien ?? null;

  const r = await db.execute(sql`
    UPDATE tr_material
    SET dongia     = ${args.price},
        mancc      = ${args.vendor_code},
        tenncc     = ${args.vendor_name},
        loaitien   = COALESCE(NULLIF(${loaiTien}, ''), loaitien),
        updated_at = now()
    WHERE company_id = ${companyId}
      AND COALESCE(idxuong, mavt) = ${args.material_code}
      AND deleted_at IS NULL
  `);

  // postgres.js trả về .count (number of affected rows) trên DML
  return [
    {
      rows_updated: Number(
        (r as unknown as { count?: number; rowCount?: number }).count ??
          (r as unknown as { count?: number; rowCount?: number }).rowCount ??
          0,
      ),
    },
  ];
}
