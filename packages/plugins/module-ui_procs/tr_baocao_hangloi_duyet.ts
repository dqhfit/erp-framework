/* Port TR_BAOCAO_HANGLOI_DUYET — duyệt báo cáo hàng lỗi (set nguoiduyet).
   Nguồn: proc-bodies/tr_baocao_hangloi_duyet.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trBaocaoHangloiDuyet(
  db: DB,
  companyId: string,
  args: { id: string; nguoiduyet: string },
): Promise<Array<{ updated: number }>> {
  if (!args.id) throw new Error("Thiếu id");
  if (!args.nguoiduyet) throw new Error("Thiếu nguoiduyet");

  const t = await procTable(db, companyId, "tr_baocao_hangloi");
  const updated = await t.updateWhere(
    { nguoiduyet: args.nguoiduyet },
    sql`${t.text("id")} = ${args.id}`,
  );
  return [{ updated }];
}
