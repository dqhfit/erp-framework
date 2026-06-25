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
    sopn?: string;
    _id?: string;
    active: boolean;
  },
): Promise<{ updated: number }> {
  if (!args.sopn && !args._id) throw new Error("Thiếu sopn");

  const t = await procTable(db, companyId, "tr_phieunhap");
  // _id = uuid VẬT LÝ dòng (rowAction inject) → match cột id; sopn = số phiếu
  // nghiệp vụ (caller cũ) → match field "sopn". Phiếu nhập head 1 dòng/số PN.
  const where = args._id ? sql`id = ${args._id}::uuid` : sql`${t.text("sopn")} = ${args.sopn}`;
  const updated = await t.updateWhere({ active: args.active }, where);

  return { updated };
}
