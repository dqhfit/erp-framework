import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

// TODO: mapping chỉ cung cấp tr_sanpham; tr_sanpham_components giả định là
// BẢNG THẬT PG cùng tên (HYBRID) với các cột hệ thống company_id/deleted_at/updated_at.
// Cần xác nhận bảng tồn tại và có đủ cột trước khi deploy.

export async function trSanphamComponentsDeletebyid(
  db: DB,
  companyId: string,
  args: { id: number },
): Promise<void> {
  if (!args.id) throw new Error("Thiếu id");

  // Proc gốc: DELETE tr_sanpham_components WHERE id = @id (hard-delete).
  // Framework dùng soft-delete — set deleted_at thay vì xoá vật lý.
  // Nếu nghiệp vụ yêu cầu hard-delete thật sự, đổi thành DELETE FROM ... và bỏ updated_at.
  await db.execute(sql`
    UPDATE tr_sanpham_components
    SET
      deleted_at = now(),
      updated_at = now()
    WHERE id          = ${args.id}
      AND company_id  = ${companyId}
      AND deleted_at  IS NULL
  `);
}
