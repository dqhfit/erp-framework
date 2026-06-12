/* Port TR_ORDER_CANCEL — huỷ đơn hàng: order + order_detail set
   choduyet=-1, f_cancelled='Y'. Nguồn: proc-bodies/tr_order_cancel.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trOrderCancel(
  db: DB,
  companyId: string,
  args: { order_number: string },
): Promise<Array<{ updated_order: number; updated_detail: number }>> {
  if (!args.order_number) throw new Error("Thiếu order_number");

  const t = await procTable(db, companyId, "tr_order");
  const updatedOrder = await t.updateWhere(
    { choduyet: -1, f_cancelled: "Y" },
    sql`${t.text("order_number")} = ${args.order_number}`,
  );

  const tDt = await procTable(db, companyId, "tr_order_detail");
  const updatedDetail = await tDt.updateWhere(
    { choduyet: -1, f_cancelled: "Y" },
    sql`${tDt.text("order_number")} = ${args.order_number}`,
  );

  return [{ updated_order: updatedOrder, updated_detail: updatedDetail }];
}
