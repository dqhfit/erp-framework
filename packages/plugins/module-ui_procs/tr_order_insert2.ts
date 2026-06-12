/* Port TR_ORDER_INSERT2 — thêm đơn hàng nếu order_number chưa tồn tại.
   Nguồn: migration-plan/ui/proc-bodies/tr_order_insert2.sql
   Ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   của bảng thật, tự version/updated_at/search_tsv, guard mirror).
   Lưu ý: field tr_order đã chuẩn hoá LOWERCASE (islock, finished, ispay...)
   qua migration_normalize_field_case — args giữ shape snake cũ.
   Semantic đổi: @id OUTPUT int (SCOPE_IDENTITY) của nguồn không tồn tại cho
   row mới — trả id uuid của row mới; trùng order_number → trả mảng rỗng. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trOrderInsert2(
  db: DB,
  companyId: string,
  args: {
    order_number: string;
    customer: string;
    order_date: string; // ISO date "YYYY-MM-DD"
    ship_date: string; // ISO date "YYYY-MM-DD"
    etd: string; // ISO date "YYYY-MM-DD"
    cont_date: string; // kiểu text trong PG
    f_cancelled: string;
    choduyet: number;
    is_lock: boolean;
    finished: boolean;
    is_pay: boolean;
    is_example: boolean;
    is_phoi: boolean;
    is_uv: boolean;
    destination_port: string;
    ship_to: string;
    remark: string;
    payment_term: string;
    carton_marking: string;
    cont_qty: number;
    cust_po_number: string;
    range: string;
    create_date: string; // ISO datetime
    create_by: string;
    update_date: string; // ISO datetime
    update_by: string;
    ngay_hangtrang?: string | null;
    ngay_son?: string | null;
    ngay_donggoi?: string | null;
    nguyenlieu?: string | null;
    bemat?: string | null;
    is_outsource?: boolean | null;
    vendor_id?: string | null;
    noisanxuat?: boolean | null; // mặc định true (= 1 trong T-SQL)
    loaidonhangmau?: number | null;
    currency_code?: string | null;
    exchange_rate?: number | null;
    fsc_id?: number | null;
    payment_term_id?: number | null;
  },
): Promise<Array<{ id: string }>> {
  if (!args.order_number) throw new Error("Thiếu order_number");

  const t = await procTable(db, companyId, "tr_order");

  // Proc gốc: IF NOT EXISTS (... WHERE order_number = @order_number)
  // — trùng thì không làm gì, trả mảng rỗng.
  const existing = await t.listWhere(sql`${t.text("order_number")} = ${args.order_number}`, {
    limit: 1,
  });
  if (existing.length > 0) return [];

  const id = await t.insertRow({
    order_number: args.order_number,
    customer: args.customer,
    order_date: args.order_date,
    ship_date: args.ship_date,
    etd: args.etd,
    cont_date: args.cont_date,
    f_cancelled: args.f_cancelled,
    choduyet: args.choduyet,
    islock: args.is_lock,
    finished: args.finished,
    ispay: args.is_pay,
    isexample: args.is_example,
    isphoi: args.is_phoi,
    isuv: args.is_uv,
    destination_port: args.destination_port,
    ship_to: args.ship_to,
    remark: args.remark,
    payment_term: args.payment_term,
    carton_marking: args.carton_marking,
    cont_qty: args.cont_qty,
    cust_po_number: args.cust_po_number,
    range: args.range,
    create_date: args.create_date,
    create_by: args.create_by,
    update_date: args.update_date,
    update_by: args.update_by,
    ngay_hangtrang: args.ngay_hangtrang ?? null,
    ngay_son: args.ngay_son ?? null,
    ngay_donggoi: args.ngay_donggoi ?? null,
    nguyenlieu: args.nguyenlieu ?? null,
    bemat: args.bemat ?? null,
    isoutsource: args.is_outsource ?? null,
    vendor_id: args.vendor_id ?? null,
    noisanxuat: args.noisanxuat ?? true,
    loaidonhangmau: args.loaidonhangmau ?? null,
    currency_code: args.currency_code ?? null,
    exchange_rate: args.exchange_rate ?? null,
    fsc_id: args.fsc_id ?? null,
    payment_term_id: args.payment_term_id ?? null,
  });

  // TODO: Proc gốc gọi EXEC PS_KEHOACH_DONHANG_CREATE @order_number, 'frmKeHoachSanXuatPO2'
  // ngay sau INSERT thành công. Cần port proc đó thành module proc riêng rồi gọi ở đây:
  //   await psKehoachDonhangCreate(db, companyId, {
  //     order_number: args.order_number,
  //     form_name: 'frmKeHoachSanXuatPO2',
  //   });
  // Tác động khi thiếu: bảng kế hoạch đơn hàng (ps_kehoach_donhang?) sẽ không được tạo.

  return [{ id }];
}
