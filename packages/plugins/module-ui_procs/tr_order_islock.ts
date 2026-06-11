import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

export async function trOrderIslock(
  db: DB,
  companyId: string,
  args: {
    is_lock: boolean;
  },
): Promise<
  Array<{
    id: number;
    order_number: string | null;
    customer: string | null;
    order_date: string | null;
    ship_date: string | null;
    etd: string | null;
    cont_date: string | null;
    f_cancelled: string | null;
    choduyet: number | null;
    IsLock: boolean | null;
    Finished: boolean | null;
    IsPay: boolean | null;
    IsExample: boolean | null;
    destination_port: string | null;
    ship_to: string | null;
    remark: string | null;
    payment_term: string | null;
    carton_marking: string | null;
    cont_qty: number | null;
    cust_po_number: string | null;
    range: string | null;
    create_date: string | null;
    create_by: string | null;
    update_date: string | null;
    update_by: string | null;
    nguoiduyet: string | null;
    ngayduyet: string | null;
    IsPhoi: boolean | null;
    IsUV: boolean | null;
    bangiamdoc_duyet: string | null;
    bangiamdoc_ngayduyet: string | null;
    ngay_hangtrang: string | null;
    ngay_son: string | null;
    ngay_donggoi: string | null;
    nguyenlieu: string | null;
    bemat: string | null;
    IsOutsource: boolean | null;
    vendor_id: string | null;
    fsc_id: number | null;
    noisanxuat: boolean | null;
    loaidonhangmau: number | null;
    currency_code: string | null;
    exchange_rate: number | null;
    ncc_phoi: string | null;
    ncc_dinhhinh: string | null;
    ncc_son: string | null;
    target_date: string | null;
    actual_date: string | null;
    kehoach_hangtrang: string | null;
    status: string | null;
    remark2: string | null;
    danhgia: string | null;
    SortOrder: number | null;
    trangthai_donhang: string | null;
    payment_term_id: number | null;
  }>
> {
  // @IsLock là tham số bắt buộc (bit), nhưng boolean false hợp lệ → không check falsy
  if (args.is_lock === undefined || args.is_lock === null) {
    throw new Error("Thiếu is_lock");
  }

  const r = await db.execute<{
    id: number;
    order_number: string | null;
    customer: string | null;
    order_date: string | null;
    ship_date: string | null;
    etd: string | null;
    cont_date: string | null;
    f_cancelled: string | null;
    choduyet: number | null;
    IsLock: boolean | null;
    Finished: boolean | null;
    IsPay: boolean | null;
    IsExample: boolean | null;
    destination_port: string | null;
    ship_to: string | null;
    remark: string | null;
    payment_term: string | null;
    carton_marking: string | null;
    cont_qty: number | null;
    cust_po_number: string | null;
    range: string | null;
    create_date: string | null;
    create_by: string | null;
    update_date: string | null;
    update_by: string | null;
    nguoiduyet: string | null;
    ngayduyet: string | null;
    IsPhoi: boolean | null;
    IsUV: boolean | null;
    bangiamdoc_duyet: string | null;
    bangiamdoc_ngayduyet: string | null;
    ngay_hangtrang: string | null;
    ngay_son: string | null;
    ngay_donggoi: string | null;
    nguyenlieu: string | null;
    bemat: string | null;
    IsOutsource: boolean | null;
    vendor_id: string | null;
    fsc_id: number | null;
    noisanxuat: boolean | null;
    loaidonhangmau: number | null;
    currency_code: string | null;
    exchange_rate: number | null;
    ncc_phoi: string | null;
    ncc_dinhhinh: string | null;
    ncc_son: string | null;
    target_date: string | null;
    actual_date: string | null;
    kehoach_hangtrang: string | null;
    status: string | null;
    remark2: string | null;
    danhgia: string | null;
    SortOrder: number | null;
    trangthai_donhang: string | null;
    payment_term_id: number | null;
  }>(sql`
    SELECT
      t.id,
      t.order_number,
      t.customer,
      t.order_date,
      t.ship_date,
      t.etd,
      t.cont_date,
      t.f_cancelled,
      t.choduyet,
      t."IsLock",
      t."Finished",
      t."IsPay",
      t."IsExample",
      t.destination_port,
      t.ship_to,
      t.remark,
      t.payment_term,
      t.carton_marking,
      t.cont_qty,
      t.cust_po_number,
      t.range,
      t.create_date,
      t.create_by,
      t.update_date,
      t.update_by,
      t.nguoiduyet,
      t.ngayduyet,
      t."IsPhoi",
      t."IsUV",
      t.bangiamdoc_duyet,
      t.bangiamdoc_ngayduyet,
      t.ngay_hangtrang,
      t.ngay_son,
      t.ngay_donggoi,
      t.nguyenlieu,
      t.bemat,
      t."IsOutsource",
      t.vendor_id,
      t.fsc_id,
      t.noisanxuat,
      t.loaidonhangmau,
      t.currency_code,
      t.exchange_rate,
      t.ncc_phoi,
      t.ncc_dinhhinh,
      t.ncc_son,
      t.target_date,
      t.actual_date,
      t.kehoach_hangtrang,
      t.status,
      t.remark2,
      t.danhgia,
      t."SortOrder",
      t.trangthai_donhang,
      t.payment_term_id
    FROM tr_order t
    WHERE t.company_id = ${companyId}
      AND t.deleted_at IS NULL
      AND t.f_cancelled = 'N'
      AND t.choduyet = 1
      AND t."IsLock" = ${args.is_lock}
    ORDER BY t.order_number
  `);

  return r as unknown as Array<{
    id: number;
    order_number: string | null;
    customer: string | null;
    order_date: string | null;
    ship_date: string | null;
    etd: string | null;
    cont_date: string | null;
    f_cancelled: string | null;
    choduyet: number | null;
    IsLock: boolean | null;
    Finished: boolean | null;
    IsPay: boolean | null;
    IsExample: boolean | null;
    destination_port: string | null;
    ship_to: string | null;
    remark: string | null;
    payment_term: string | null;
    carton_marking: string | null;
    cont_qty: number | null;
    cust_po_number: string | null;
    range: string | null;
    create_date: string | null;
    create_by: string | null;
    update_date: string | null;
    update_by: string | null;
    nguoiduyet: string | null;
    ngayduyet: string | null;
    IsPhoi: boolean | null;
    IsUV: boolean | null;
    bangiamdoc_duyet: string | null;
    bangiamdoc_ngayduyet: string | null;
    ngay_hangtrang: string | null;
    ngay_son: string | null;
    ngay_donggoi: string | null;
    nguyenlieu: string | null;
    bemat: string | null;
    IsOutsource: boolean | null;
    vendor_id: string | null;
    fsc_id: number | null;
    noisanxuat: boolean | null;
    loaidonhangmau: number | null;
    currency_code: string | null;
    exchange_rate: number | null;
    ncc_phoi: string | null;
    ncc_dinhhinh: string | null;
    ncc_son: string | null;
    target_date: string | null;
    actual_date: string | null;
    kehoach_hangtrang: string | null;
    status: string | null;
    remark2: string | null;
    danhgia: string | null;
    SortOrder: number | null;
    trangthai_donhang: string | null;
    payment_term_id: number | null;
  }>;
}
