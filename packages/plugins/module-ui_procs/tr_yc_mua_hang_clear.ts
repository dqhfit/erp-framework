/* Xoá working set tạm tr_yc_mua_hang của công ty.
   Gọi khi RỜI trang "Tạo y/c mua hàng" (c81743af) — để danh sách KHÔNG nhớ
   dữ liệu giữa các lần ghé trang. Fire-and-forget từ ConsumerPage.onLeaveProc. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";

export async function clearYcMuaHang(
  db: DB,
  companyId: string,
): Promise<{ ok: boolean; message: string }[]> {
  await db.execute(sql`DELETE FROM tr_yc_mua_hang WHERE company_id = ${companyId}::uuid`);
  return [{ ok: true, message: "Đã xoá danh sách yêu cầu mua hàng tạm." }];
}
