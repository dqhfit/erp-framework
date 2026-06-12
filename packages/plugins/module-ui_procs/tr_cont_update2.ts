/* Port TR_CONT_UPDATE2 — cập nhật container theo cont_id (uniqueidentifier),
   sau đó đồng bộ macont = cont_number mới cho mọi dòng chi tiết tr_ctcont
   cùng cont_id (proc gốc bọc IF EXISTS — update 0 dòng tương đương).
   Proc gốc KHÔNG update nguoitao/ngaytao — nhận arg nhưng không ghi.
   Tham số @IsFinish/@IsPay/@cont_Gross/@PerPONo map sang field lowercase
   isfinish/ispay/cont_gross/perpono (theo import-items).
   Tham số optional default NULL của T-SQL → set NULL khi không truyền
   (proc gốc luôn SET đủ mọi cột).
   Nguồn: migration-plan/ui/proc-bodies/tr_cont_update2.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trContUpdate2(
  db: DB,
  companyId: string,
  args: {
    cont_id: string;
    cont_number: string | null;
    cont_name: string | null;
    description: string | null;
    seal_number: string | null;
    order_number: string | null;
    cust_po: string | null;
    ngaycontve: string | null;
    ngaychatcont: string | null;
    ngayxuat: string | null;
    trangthai: boolean | null;
    count_print: number | null;
    remark: string | null;
    nguoitao: string | null;
    ngaytao: string | null;
    nguoisua: string | null;
    ngaysua: string | null;
    isfinish: boolean | null;
    ispay: boolean | null;
    sodocont?: string | null;
    si_id?: string | null;
    cont_targe?: number | null;
    cont_gross?: string | null;
    cont_type?: string | null;
    vgm_cont_owner?: string | null;
    perpono?: string | null;
  },
): Promise<Array<{ updated: number }>> {
  if (!args.cont_id) throw new Error("Thiếu cont_id");

  const t = await procTable(db, companyId, "tr_cont");
  const updated = await t.updateWhere(
    {
      cont_number: args.cont_number,
      cont_name: args.cont_name,
      description: args.description,
      seal_number: args.seal_number,
      order_number: args.order_number,
      cust_po: args.cust_po,
      ngaycontve: args.ngaycontve,
      ngaychatcont: args.ngaychatcont,
      ngayxuat: args.ngayxuat,
      trangthai: args.trangthai,
      count_print: args.count_print,
      remark: args.remark,
      nguoisua: args.nguoisua,
      ngaysua: args.ngaysua,
      isfinish: args.isfinish,
      ispay: args.ispay,
      sodocont: args.sodocont ?? null,
      si_id: args.si_id ?? null,
      cont_targe: args.cont_targe ?? 0, // T-SQL: @cont_targe float = 0
      cont_gross: args.cont_gross ?? null,
      cont_type: args.cont_type ?? null,
      vgm_cont_owner: args.vgm_cont_owner ?? null,
      perpono: args.perpono ?? null,
    },
    sql`${t.text("cont_id")} = ${args.cont_id}`,
  );

  // Đồng bộ mã cont ở bảng chi tiết theo số cont mới
  const tCt = await procTable(db, companyId, "tr_ctcont");
  await tCt.updateWhere(
    { macont: args.cont_number },
    sql`${tCt.text("cont_id")} = ${args.cont_id}`,
  );

  return [{ updated }];
}
