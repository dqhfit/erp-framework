/* Port TR_ORDER_UPDATE2 — cập nhật đơn hàng theo id nguồn (int).
   Nguồn: migration-plan/ui/proc-bodies/tr_order_update2.sql
   Ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   f_... hoặc ext của bảng thật, tự version/updated_at/search_tsv, guard mirror).
   CHÚ Ý case field theo field-map: IsLock/Finished/IsPay/IsExample/IsPhoi/
   IsUV/IsOutsource viết hoa chữ đầu — sai case sẽ bị helper reject.
   Proc gốc nhận @create_date/@create_by nhưng KHÔNG đưa vào SET — giữ nguyên
   (args vẫn nhận để khớp chữ ký proc, không ghi). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trOrderUpdate2(
  db: DB,
  companyId: string,
  args: {
    id: number;
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
    isphoi?: boolean | null;
    isuv?: boolean | null;
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
    isoutsource?: boolean | null;
    vendor_id?: string | null;
    noisanxuat?: boolean | null;
    loaidonhangmau?: number | null;
    currency_code?: string | null;
    exchange_rate?: number | null;
    fsc_id?: number | null;
    payment_term_id?: number | null;
  },
): Promise<{ updated: number }> {
  if (!args.id) throw new Error("Thiếu id");

  const t = await procTable(db, companyId, "tr_order");
  const updated = await t.updateWhere(
    {
      order_number: args.order_number,
      customer: args.customer ?? null,
      order_date: args.order_date ?? null,
      ship_date: args.ship_date ?? null,
      etd: args.etd ?? null,
      cont_date: args.cont_date ?? null,
      f_cancelled: args.f_cancelled ?? null,
      choduyet: args.choduyet ?? null,
      IsLock: args.islock ?? null,
      Finished: args.finished ?? null,
      IsPay: args.ispay ?? null,
      IsExample: args.isexample ?? null,
      IsPhoi: args.isphoi ?? null,
      IsUV: args.isuv ?? null,
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
      IsOutsource: args.isoutsource ?? null,
      vendor_id: args.vendor_id ?? null,
      // T-SQL default @noisanxuat bit = 1
      noisanxuat: args.noisanxuat ?? true,
      loaidonhangmau: args.loaidonhangmau ?? null,
      currency_code: args.currency_code ?? null,
      exchange_rate: args.exchange_rate ?? null,
      fsc_id: args.fsc_id ?? null,
      payment_term_id: args.payment_term_id ?? null,
    },
    sql`${t.num("id")} = ${args.id}`,
  );

  return { updated };
}
