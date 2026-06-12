/* Port TR_ORDER_DETAIL_INSERT2 — thêm dòng chi tiết đơn hàng.
   Trả uuid row mới (khác SCOPE_IDENTITY int nguồn — id int nguồn không
   tồn tại cho row tạo từ hệ mới). Field finished/isrelease/idordernumber
   lowercase theo entities.fields. Nguồn: proc-bodies/tr_order_detail_insert2.sql */
import type { DB } from "@erp-framework/server/db";
import { procTable } from "../src/proc-table";

export async function trOrderDetailInsert2(
  db: DB,
  companyId: string,
  args: {
    customer?: string | null;
    agent?: string | null;
    range?: string | null;
    order_number: string;
    item_number?: string | null;
    cust_item_number?: string | null;
    description?: string | null;
    color?: string | null;
    material?: string | null;
    order_qty?: number | null;
    cbm?: number | null;
    price?: number | null;
    currency?: string | null;
    amount?: number | null;
    bill_to?: string | null;
    ship_to?: string | null;
    input_qty?: number | null;
    destination_port?: string | null;
    etd?: string | null;
    ship_date?: string | null;
    ship_qty?: number | null;
    order_date?: string | null;
    cont_date?: string | null;
    container_size?: string | null;
    nccht?: string | null;
    payment_term?: string | null;
    remark?: string | null;
    cust_po_number?: string | null;
    attribute4?: string | null;
    choduyet?: string | null;
    f_cancelled?: string | null;
    finished?: boolean | null;
    isrelease?: boolean | null;
    create_by?: string | null;
    create_date?: string | null;
    update_by?: string | null;
    update_date?: string | null;
    test_run_qty?: number | null;
    fsc_100?: boolean | null;
    fsc_cw?: boolean | null;
    fsc_mix?: boolean | null;
    fsc_recycled?: boolean | null;
    idordernumber?: number | null;
    tenkhoahoc?: string | null;
    fsc_id?: number | null;
  },
): Promise<Array<{ id: string }>> {
  if (!args.order_number) throw new Error("Thiếu order_number");

  const t = await procTable(db, companyId, "tr_order_detail");
  const id = await t.insertRow({
    customer: args.customer ?? null,
    agent: args.agent ?? null,
    range: args.range ?? null,
    order_number: args.order_number,
    item_number: args.item_number ?? null,
    cust_item_number: args.cust_item_number ?? null,
    description: args.description ?? null,
    color: args.color ?? null,
    material: args.material ?? null,
    order_qty: args.order_qty ?? null,
    cbm: args.cbm ?? null,
    price: args.price ?? null,
    currency: args.currency ?? null,
    amount: args.amount ?? null,
    bill_to: args.bill_to ?? null,
    ship_to: args.ship_to ?? null,
    input_qty: args.input_qty ?? null,
    destination_port: args.destination_port ?? null,
    etd: args.etd ?? null,
    ship_date: args.ship_date ?? null,
    ship_qty: args.ship_qty ?? null,
    order_date: args.order_date ?? null,
    cont_date: args.cont_date ?? null,
    container_size: args.container_size ?? null,
    nccht: args.nccht ?? null,
    payment_term: args.payment_term ?? null,
    remark: args.remark ?? null,
    cust_po_number: args.cust_po_number ?? null,
    attribute4: args.attribute4 ?? null,
    choduyet: args.choduyet ?? null,
    f_cancelled: args.f_cancelled ?? null,
    finished: args.finished ?? null,
    isrelease: args.isrelease ?? null,
    create_by: args.create_by ?? null,
    create_date: args.create_date ?? null,
    update_by: args.update_by ?? null,
    update_date: args.update_date ?? null,
    test_run_qty: args.test_run_qty ?? 0,
    fsc_100: args.fsc_100 ?? false,
    fsc_cw: args.fsc_cw ?? false,
    fsc_mix: args.fsc_mix ?? false,
    fsc_recycled: args.fsc_recycled ?? false,
    idordernumber: args.idordernumber ?? null,
    tenkhoahoc: args.tenkhoahoc ?? null,
    fsc_id: args.fsc_id ?? null,
  });
  return [{ id }];
}
