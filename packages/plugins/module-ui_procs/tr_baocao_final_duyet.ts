/* Port TR_BAOCAO_FINAL_DUYET — duyệt báo cáo final.
   Nguồn: migration-plan/ui/proc-bodies/tr_baocao_final_duyet.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trBaocaoFinalDuyet(
  db: DB,
  companyId: string,
  args: {
    report_id: string;
    nguoiduyet: string;
    ngayduyet: string;
  },
): Promise<Array<{ updated: number }>> {
  if (!args.report_id) throw new Error("Thiếu report_id");
  if (!args.nguoiduyet) throw new Error("Thiếu nguoiduyet");

  const t = await procTable(db, companyId, "tr_baocao_final");
  const updated = await t.updateWhere(
    { nguoiduyet: args.nguoiduyet, ngayduyet: args.ngayduyet },
    sql`${t.text("report_id")} = ${args.report_id}`,
  );
  return [{ updated }];
}
