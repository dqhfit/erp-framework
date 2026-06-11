import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

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
): Promise<Array<{ id: number }>> {
  if (!args.order_number) throw new Error("Thiếu order_number");

  // Tương đương IF NOT EXISTS trong proc gốc — scope theo tenant
  const existRows = await db.execute<{ id: number }>(sql`
    SELECT id FROM tr_order
    WHERE company_id = ${companyId}
      AND order_number = ${args.order_number}
      AND deleted_at IS NULL
    LIMIT 1
  `);
  if ((existRows as unknown as Array<unknown>).length > 0) {
    // order_number đã tồn tại — proc gốc không làm gì, trả mảng rỗng
    return [];
  }

  const r = await db.execute<{ id: number }>(sql`
    INSERT INTO tr_order (
      company_id,
      order_number,
      customer,
      order_date,
      ship_date,
      etd,
      cont_date,
      f_cancelled,
      choduyet,
      islock,
      finished,
      ispay,
      isexample,
      isphoi,
      isuv,
      destination_port,
      ship_to,
      remark,
      payment_term,
      carton_marking,
      cont_qty,
      cust_po_number,
      range,
      create_date,
      create_by,
      update_date,
      update_by,
      ngay_hangtrang,
      ngay_son,
      ngay_donggoi,
      nguyenlieu,
      bemat,
      isoutsource,
      vendor_id,
      noisanxuat,
      loaidonhangmau,
      currency_code,
      exchange_rate,
      fsc_id,
      payment_term_id,
      created_at,
      updated_at
    ) VALUES (
      ${companyId},
      ${args.order_number},
      ${args.customer},
      ${args.order_date},
      ${args.ship_date},
      ${args.etd},
      ${args.cont_date},
      ${args.f_cancelled},
      ${args.choduyet},
      ${args.is_lock},
      ${args.finished},
      ${args.is_pay},
      ${args.is_example},
      ${args.is_phoi},
      ${args.is_uv},
      ${args.destination_port},
      ${args.ship_to},
      ${args.remark},
      ${args.payment_term},
      ${args.carton_marking},
      ${args.cont_qty},
      ${args.cust_po_number},
      ${args.range},
      ${args.create_date},
      ${args.create_by},
      ${args.update_date},
      ${args.update_by},
      ${args.ngay_hangtrang ?? null},
      ${args.ngay_son ?? null},
      ${args.ngay_donggoi ?? null},
      ${args.nguyenlieu ?? null},
      ${args.bemat ?? null},
      ${args.is_outsource ?? null},
      ${args.vendor_id ?? null},
      ${args.noisanxuat ?? true},
      ${args.loaidonhangmau ?? null},
      ${args.currency_code ?? null},
      ${args.exchange_rate ?? null},
      ${args.fsc_id ?? null},
      ${args.payment_term_id ?? null},
      now(),
      now()
    )
    RETURNING id
  `);

  // TODO: Proc gốc gọi EXEC PS_KEHOACH_DONHANG_CREATE @order_number, 'frmKeHoachSanXuatPO2'
  // ngay sau INSERT thành công. Cần port proc đó thành module proc riêng rồi gọi ở đây:
  //   await psKehoachDonhangCreate(db, companyId, {
  //     order_number: args.order_number,
  //     form_name: 'frmKeHoachSanXuatPO2',
  //   });
  // Tác động khi thiếu: bảng kế hoạch đơn hàng (ps_kehoach_donhang?) sẽ không được tạo.

  return r as unknown as Array<{ id: number }>;
}
