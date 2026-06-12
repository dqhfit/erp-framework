/* Port TR_DANHSACH_DEXUAT_CANCEL — huỷ đề xuất theo nhóm + mã.
   Nguồn: migration-plan/ui/proc-bodies/tr_danhsach_dexuat_cancel.sql

   Ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   f_... hoặc ext của bảng thật, tự version/updated_at, guard mirror).
   Proc gốc: UPDATE tr_danhsach_dexuat SET trangthai_dexuat2 = 'CANCEL',
   trangthai_dexuat = 0 WHERE nhom_dexuat + ma_dexuat.
   trangthai_dexuat nguồn là bit → entity import kiểu boolean → set false. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trDanhsachDexuatCancel(
  db: DB,
  companyId: string,
  args: {
    nhom_dexuat: string;
    ma_dexuat: string;
  },
): Promise<Array<{ updated: number }>> {
  if (!args.nhom_dexuat) throw new Error("Thiếu nhom_dexuat");
  if (!args.ma_dexuat) throw new Error("Thiếu ma_dexuat");

  const t = await procTable(db, companyId, "tr_danhsach_dexuat");
  const updated = await t.updateWhere(
    { trangthai_dexuat2: "CANCEL", trangthai_dexuat: false },
    sql`${t.text("nhom_dexuat")} = ${args.nhom_dexuat} AND ${t.text("ma_dexuat")} = ${args.ma_dexuat}`,
  );
  return [{ updated }];
}
