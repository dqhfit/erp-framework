/* Port TR_ORDER_EXAMPLE_UPDATE2 — cập nhật header đơn hàng mẫu theo
   order_number (khoá nghiệp vụ, không phải PK). @create_date/@create_by
   nhận nhưng KHÔNG ghi (proc gốc không SET).
   Nguồn: migration-plan/ui/proc-bodies/tr_order_example_update2.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trOrderExampleUpdate2(
  db: DB,
  companyId: string,
  args: {
    order_number: string;
    customer?: string | null;
    order_date?: string | null;
    ship_date?: string | null;
    etd?: string | null;
    cont_date?: string | null;
    f_cancelled?: string | null;
    choduyet?: number | null;
    islock?: boolean | null;
    finished?: boolean | null;
    ispay?: boolean | null;
    isexample?: boolean | null;
    destination_port?: string | null;
    ship_to?: string | null;
    remark?: string | null;
    payment_term?: string | null;
    carton_marking?: string | null;
    cont_qty?: number | null;
    cust_po_number?: string | null;
    range?: string | null;
    create_date?: string | null; // không ghi
    create_by?: string | null; // không ghi
    update_date?: string | null;
    update_by?: string | null;
    ngay_hangtrang?: string | null;
    ngay_son?: string | null;
    ngay_donggoi?: string | null;
    nguyenlieu?: string | null;
    bemat?: string | null;
  },
): Promise<Array<{ updated: number }>> {
  if (!args.order_number) throw new Error("Thiếu order_number");

  const t = await procTable(db, companyId, "tr_order_example");
  const updated = await t.updateWhere(
    {
      customer: args.customer ?? null,
      order_date: args.order_date ?? null,
      ship_date: args.ship_date ?? null,
      etd: args.etd ?? null,
      cont_date: args.cont_date ?? null,
      f_cancelled: args.f_cancelled ?? null,
      choduyet: args.choduyet ?? null,
      islock: args.islock ?? null,
      finished: args.finished ?? null,
      ispay: args.ispay ?? null,
      isexample: args.isexample ?? null,
      destination_port: args.destination_port ?? null,
      ship_to: args.ship_to ?? null,
      remark: args.remark ?? null,
      payment_term: args.payment_term ?? null,
      carton_marking: args.carton_marking ?? null,
      cont_qty: args.cont_qty ?? null,
      cust_po_number: args.cust_po_number ?? null,
      range: args.range ?? null,
      update_date: args.update_date ?? null,
      update_by: args.update_by ?? null,
      ngay_hangtrang: args.ngay_hangtrang ?? null,
      ngay_son: args.ngay_son ?? null,
      ngay_donggoi: args.ngay_donggoi ?? null,
      nguyenlieu: args.nguyenlieu ?? null,
      bemat: args.bemat ?? null,
    },
    sql`${t.text("order_number")} = ${args.order_number}`,
  );
  return [{ updated }];
}
