/* Port TR_PHIEUNHAP_UPDATESTATUS — đổi trạng thái active của phiếu nhập theo số PN.
   Nguồn: migration-plan/ui/proc-bodies/tr_phieunhap_updatestatus.sql
   Ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   f_... hoặc ext của bảng thật, tự version/updated_at, guard mirror). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trPhieunhapUpdatestatus(
  db: DB,
  companyId: string,
  args: {
    sopn: string;
    active: boolean;
  },
): Promise<{ updated: number }> {
  if (!args.sopn) throw new Error("Thiếu sopn");

  const t = await procTable(db, companyId, "tr_phieunhap");
  const updated = await t.updateWhere(
    { active: args.active },
    sql`${t.text("sopn")} = ${args.sopn}`,
  );

  return { updated };
}
