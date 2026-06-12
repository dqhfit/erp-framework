/* Port TR_THAYDOI_KYTHUAT_CANCEL — huỷ phiếu thay đổi kỹ thuật (active=false).
   Nguồn: proc-bodies/tr_thaydoi_kythuat_cancel.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trThaydoiKythuatCancel(
  db: DB,
  companyId: string,
  args: { id: string },
): Promise<Array<{ updated: number }>> {
  if (!args.id) throw new Error("Thiếu id");

  const t = await procTable(db, companyId, "tr_thaydoi_kythuat");
  const updated = await t.updateWhere({ active: false }, sql`${t.text("id")} = ${args.id}`);
  return [{ updated }];
}
