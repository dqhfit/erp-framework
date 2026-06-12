/* Port TR_CTCONT_UPDATEBYID — cập nhật 1 dòng chi tiết container theo id (int).
   Proc gốc KHÔNG update nguoitao/ngaytao — nhận arg nhưng không ghi.
   Tham số @ProformaInvoice/@ProformaInvoiceDetail (uniqueidentifier, default
   NULL) map sang field lowercase proformainvoice/proformainvoicedetail và
   set NULL khi không truyền (proc gốc luôn SET đủ mọi cột).
   Nguồn: migration-plan/ui/proc-bodies/tr_ctcont_updatebyid.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trCtcontUpdatebyid(
  db: DB,
  companyId: string,
  args: {
    id: number;
    cont_id: string | null;
    order_id: number | null;
    madonhang: string | null;
    makhachhang: string | null;
    masp: string | null;
    masp2: string | null;
    macont: string | null;
    mausac: string | null;
    soluong: number | null;
    dvt: string | null;
    ghichu: string | null;
    nguoitao: string | null;
    ngaytao: string | null;
    nguoisua: string | null;
    ngaysua: string | null;
    proformainvoice?: string | null;
    proformainvoicedetail?: string | null;
  },
): Promise<Array<{ updated: number }>> {
  if (args.id == null) throw new Error("Thiếu id");

  const t = await procTable(db, companyId, "tr_ctcont");
  const updated = await t.updateWhere(
    {
      cont_id: args.cont_id,
      order_id: args.order_id,
      madonhang: args.madonhang,
      makhachhang: args.makhachhang,
      masp: args.masp,
      masp2: args.masp2,
      macont: args.macont,
      mausac: args.mausac,
      soluong: args.soluong,
      dvt: args.dvt,
      ghichu: args.ghichu,
      nguoisua: args.nguoisua,
      ngaysua: args.ngaysua,
      proformainvoice: args.proformainvoice ?? null,
      proformainvoicedetail: args.proformainvoicedetail ?? null,
    },
    sql`${t.num("id")} = ${args.id}`,
  );
  return [{ updated }];
}
