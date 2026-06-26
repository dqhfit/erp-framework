/* Port TR_PHIEUXUAT_UPDATESTATUS — đổi trạng thái active của phiếu xuất theo số PX.
   Nguồn: migration-plan/ui/proc-bodies/tr_phieuxuat_updatestatus.sql
   Ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   f_... hoặc ext của bảng thật, tự version/updated_at, guard mirror). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trPhieuxuatUpdatestatus(
  db: DB,
  companyId: string,
  args: {
    so_px?: string;
    _id?: string;
    active: boolean;
  },
): Promise<Array<Record<string, never>>> {
  if (!args.so_px && !args._id) throw new Error("Thiếu so_px");

  const t = await procTable(db, companyId, "tr_phieuxuat");
  // _id = uuid VẬT LÝ dòng (rowAction inject) → match cột id; so_px = số phiếu
  // nghiệp vụ (caller cũ) → match field "sopx". Phiếu xuất head 1 dòng/số PX.
  const where = args._id ? sql`id = ${args._id}::uuid` : sql`${t.text("sopx")} = ${args.so_px}`;
  await t.updateWhere({ active: args.active }, where);

  return [];
}
