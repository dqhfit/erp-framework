/* Port TR_ORDER_DETAIL_DELETE2 — xoá 1 dòng chi tiết đơn hàng theo id (int nguồn).
   DELETE gốc → soft-delete (chuẩn hệ mới). Nguồn: proc-bodies/tr_order_detail_delete2.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trOrderDetailDelete2(
  db: DB,
  companyId: string,
  args: { id: number },
): Promise<number> {
  if (args.id == null) throw new Error("Thiếu id");

  const t = await procTable(db, companyId, "tr_order_detail");
  return t.softDeleteWhere(sql`${t.num("id")} = ${args.id}`);
}
