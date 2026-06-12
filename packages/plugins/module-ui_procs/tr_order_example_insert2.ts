/* Port TR_ORDER_EXAMPLE_INSERT2 — thêm header đơn hàng mẫu.
   Proc gốc IF NOT EXISTS theo order_number mới INSERT — đã tồn tại thì
   bỏ qua im lặng; port trả mảng RỖNG cho nhánh đó (caller phân biệt được).
   Trả [{ id: uuid }] khi insert (khác semantic SCOPE_IDENTITY nguồn).
   Nguồn: migration-plan/ui/proc-bodies/tr_order_example_insert2.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trOrderExampleInsert2(
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
    create_date?: string | null;
    create_by?: string | null;
    update_date?: string | null;
    update_by?: string | null;
    ngay_hangtrang?: string | null;
    ngay_son?: string | null;
    ngay_donggoi?: string | null;
    nguyenlieu?: string | null;
    bemat?: string | null;
  },
): Promise<Array<{ id: string }>> {
  if (!args.order_number) throw new Error("Thiếu order_number");

  const t = await procTable(db, companyId, "tr_order_example");

  // IF NOT EXISTS — đã có order_number thì không insert (như proc gốc).
  const existing = await t.listWhere(sql`${t.text("order_number")} = ${args.order_number}`, {
    limit: 1,
  });
  if (existing.length > 0) return [];

  const id = await t.insertRow({
    order_number: args.order_number,
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
    create_date: args.create_date ?? null,
    create_by: args.create_by ?? null,
    update_date: args.update_date ?? null,
    update_by: args.update_by ?? null,
    ngay_hangtrang: args.ngay_hangtrang ?? null,
    ngay_son: args.ngay_son ?? null,
    ngay_donggoi: args.ngay_donggoi ?? null,
    nguyenlieu: args.nguyenlieu ?? null,
    bemat: args.bemat ?? null,
  });
  return [{ id }];
}
