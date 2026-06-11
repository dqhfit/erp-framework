import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

// TODO: Bảng nguồn T-SQL là `dbo.tr_muctieu_sanxuat` (KHÔNG có hậu tố "2").
// Mapping được cung cấp chỉ liệt kê `tr_muctieu_sanxuat2` và `tr_muctieu_sanxuat2_chitiet`.
// Cần xác nhận một trong hai khả năng:
//   (a) Bảng PG tương ứng là `tr_muctieu_sanxuat` (tên giữ nguyên, chưa được đưa vào mapping).
//   (b) Proc thực ra nhắm đến `tr_muctieu_sanxuat2_chitiet` — bảng duy nhất có cả cột
//       `ngaythang` (date) lẫn `macongdoan` (text) khớp với điều kiện WHERE của T-SQL.
// Hiện tại giả định (a): tên bảng PG = `tr_muctieu_sanxuat`.
// Nếu đúng là (b), thay `tr_muctieu_sanxuat` → `tr_muctieu_sanxuat2_chitiet` trong câu DELETE.

export async function trMuctieuSanxuatDeleteall(
  db: DB,
  companyId: string,
  args: {
    year: number;
    month: number;
    macongdoan: string;
  },
): Promise<void> {
  if (!args.year) throw new Error("Thiếu year");
  if (!args.month) throw new Error("Thiếu month");
  if (!args.macongdoan) throw new Error("Thiếu macongdoan");

  // Xoá toàn bộ mục tiêu sản xuất theo năm/tháng/công đoạn
  // T-SQL: DELETE ... WHERE YEAR(ngaythang)=@year AND MONTH(ngaythang)=@month AND macongdoan=@macongdoan
  await db.execute(sql`
    DELETE FROM tr_muctieu_sanxuat
    WHERE company_id = ${companyId}
      AND EXTRACT(YEAR FROM ngaythang) = ${args.year}
      AND EXTRACT(MONTH FROM ngaythang) = ${args.month}
      AND macongdoan = ${args.macongdoan}
  `);
}
