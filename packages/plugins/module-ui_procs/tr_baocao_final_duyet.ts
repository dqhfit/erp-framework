/* Port TR_BAOCAO_FINAL_DUYET — duyệt báo cáo final.
   Nguồn: migration-plan/ui/proc-bodies/tr_baocao_final_duyet.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trBaocaoFinalDuyet(
  db: DB,
  companyId: string,
  args: {
    report_id?: string;
    _id?: string;
    nguoiduyet: string;
    ngayduyet: string;
  },
): Promise<Array<{ updated: number }>> {
  if (!args.report_id && !args._id) throw new Error("Thiếu report_id");
  if (!args.nguoiduyet) throw new Error("Thiếu nguoiduyet");

  const t = await procTable(db, companyId, "tr_baocao_final");
  // _id = uuid VẬT LÝ của dòng (rowAction tự inject) → match cột id; report_id
  // = khoá nghiệp vụ (caller cũ) → match field "report_id".
  const where = args._id
    ? sql`id = ${args._id}::uuid`
    : sql`${t.text("report_id")} = ${args.report_id}`;
  const updated = await t.updateWhere(
    { nguoiduyet: args.nguoiduyet, ngayduyet: args.ngayduyet },
    where,
  );
  return [{ updated }];
}
