/* Port TR_ORDER_DETAIL_SETKHONGTINHSON — bật/tắt cờ không tính sơn của
   1 dòng chi tiết đơn hàng. Nguồn: proc-bodies/tr_order_detail_setkhongtinhson.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trOrderDetailSetkhongtinhson(
  db: DB,
  companyId: string,
  args: { id: number; khongtinhson: boolean },
): Promise<Array<{ updated: number }>> {
  if (args.id == null) throw new Error("Thiếu id");
  if (args.khongtinhson == null) throw new Error("Thiếu khongtinhson");

  const t = await procTable(db, companyId, "tr_order_detail");
  const updated = await t.updateWhere(
    { khongtinhson: args.khongtinhson },
    sql`${t.num("id")} = ${args.id}`,
  );
  return [{ updated }];
}
