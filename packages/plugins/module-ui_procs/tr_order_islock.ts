/* Port TR_ORDER_ISLOCK — danh sách đơn hàng theo trạng thái khoá.
   Nguồn: migration-plan/ui/proc-bodies/tr_order_islock.sql
   Đọc qua procTable: field "islock" (type bool, ext-tier — đã chuẩn hoá
   lowercase qua migration_normalize_field_case) + f_cancelled,
   choduyet — biểu thức cột compose theo meta.storage lúc runtime. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trOrderIslock(
  db: DB,
  companyId: string,
  args: {
    is_lock: boolean;
  },
): Promise<Array<Record<string, unknown>>> {
  // @IsLock là tham số bắt buộc (bit), boolean false hợp lệ → không check falsy
  if (args.is_lock === undefined || args.is_lock === null) {
    throw new Error("Thiếu is_lock");
  }

  const t = await procTable(db, companyId, "tr_order");
  // Proc gốc: WHERE f_cancelled = 'N' AND choduyet = 1 AND islock = @IsLock
  // ORDER BY order_number — trả mọi cột (SELECT *).
  return t.listWhere(
    sql`${t.text("f_cancelled")} = 'N'
        AND ${t.num("choduyet")} = 1
        AND ${t.bool("islock")} = ${args.is_lock}`,
    { orderBy: sql`${t.text("order_number")} ASC` },
  );
}
