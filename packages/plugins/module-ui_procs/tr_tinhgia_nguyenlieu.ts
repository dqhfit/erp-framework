import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

// TODO: Bảng `bg_donhang` và `bg_donhang_chitiet` KHÔNG có trong mapping
// được cung cấp cho proc này. Cần xác nhận thêm trước khi deploy:
//   1. Tên bảng PG thực tế (có thể là `bg_donhang` / `bg_donhang_chitiet` hoặc khác)
//   2. Các cột cần thiết:
//      - bg_donhang:        sophieu (text), id_dexuat (text), tigia (numeric), company_id
//      - bg_donhang_chitiet: sophieu (text), sokhoi (numeric), thanhtien (numeric), company_id
//   3. Xác nhận hai bảng này có cột `company_id` để filter tenant
//   4. Xác nhận có cột `deleted_at` để áp soft-delete guard

export async function trTinhgiaNguyenlieu(
  db: DB,
  companyId: string,
  args: {
    donhang: string;
  },
): Promise<Array<{ dongia_nguyen_lieu: number }>> {
  if (!args.donhang) throw new Error("Thiếu donhang");

  // Tính đơn giá nguyên liệu = tổng thành tiền VND / tổng số khối
  // Logic gốc T-SQL: IIF(@sokhoi <= 0, 0, @thanhtien_vnd / @sokhoi)
  //
  // CHARINDEX(@donhang, C.donhang) > 0 → POSITION(${donhang} IN c.donhang) > 0
  //
  // INNER JOIN tr_dexuat_phoi_chitiet d ON c.id = d.dexuat_id không đóng góp vào
  // SELECT hay WHERE — chỉ là bộ lọc existence (chỉ lấy phiếu đề xuất có ít nhất
  // 1 dòng chi tiết). Giữ nguyên để trung thực với logic gốc.
  const rows = await db.execute<{
    sokhoi: string;
    thanhtien_vnd: string;
  }>(sql`
    SELECT
      COALESCE(SUM(b.sokhoi), 0)              AS sokhoi,
      COALESCE(SUM(b.thanhtien * a.tigia), 0) AS thanhtien_vnd
    FROM bg_donhang a
    -- TODO: xác nhận company_id + deleted_at trên bg_donhang
    INNER JOIN bg_donhang_chitiet b
      ON b.sophieu = a.sophieu
    -- TODO: xác nhận company_id + deleted_at trên bg_donhang_chitiet
    INNER JOIN tr_dexuat_phoi c
      ON c.id = a.id_dexuat
      AND c.company_id = ${companyId}
      AND c.deleted_at IS NULL
    INNER JOIN tr_dexuat_phoi_chitiet d
      ON d.dexuat_id = c.id
      AND d.deleted_at IS NULL
    WHERE a.company_id = ${companyId}
      AND POSITION(${args.donhang} IN c.donhang) > 0
  `);

  const row = (rows as unknown as Array<{ sokhoi: string; thanhtien_vnd: string }>)[0];

  const sokhoi = Number(row?.sokhoi ?? 0);
  const thanhtienVnd = Number(row?.thanhtien_vnd ?? 0);
  const dongiaResult = sokhoi <= 0 ? 0 : thanhtienVnd / sokhoi;

  return [{ dongia_nguyen_lieu: dongiaResult }];
}
