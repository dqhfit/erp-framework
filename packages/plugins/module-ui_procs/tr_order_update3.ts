/* Port TR_ORDER_UPDATE3 — cập nhật thông tin kế hoạch/NCC của đơn hàng
   theo id nguồn (int). Lưu ý: @danhgia khai báo nhưng KHÔNG nằm trong SET
   ở proc gốc → nhận arg nhưng không ghi (giữ nguyên hành vi nguồn).
   Field "SortOrder" + "status" đúng case theo entities.fields.
   Nguồn: proc-bodies/tr_order_update3.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trOrderUpdate3(
  db: DB,
  companyId: string,
  args: {
    order_id: number;
    soluong_cont?: number | null;
    fsc_id?: number | null;
    ncc_phoi?: string | null;
    ncc_dinhhinh?: string | null;
    ncc_son?: string | null;
    target_date?: string | null;
    actual_date?: string | null;
    kehoach_hangtrang?: string | null;
    status?: number | null;
    remark2?: string | null;
    danhgia?: string | null; // không ghi — xem ghi chú đầu file
    trangthai_donhang?: string | null;
    sort_order?: number | null;
  },
): Promise<Array<{ updated: number }>> {
  if (args.order_id == null) throw new Error("Thiếu order_id");

  const t = await procTable(db, companyId, "tr_order");
  const updated = await t.updateWhere(
    {
      cont_qty: args.soluong_cont ?? null,
      fsc_id: args.fsc_id ?? null,
      ncc_phoi: args.ncc_phoi ?? null,
      ncc_dinhhinh: args.ncc_dinhhinh ?? null,
      ncc_son: args.ncc_son ?? null,
      target_date: args.target_date ?? null,
      actual_date: args.actual_date ?? null,
      kehoach_hangtrang: args.kehoach_hangtrang ?? null,
      status: args.status ?? null,
      remark2: args.remark2 ?? null,
      trangthai_donhang: args.trangthai_donhang ?? null,
      SortOrder: args.sort_order ?? null,
    },
    sql`${t.num("id")} = ${args.order_id}`,
  );
  return [{ updated }];
}
