/* Port TR_DONDATHANG_CANCEL — huỷ đơn đặt hàng: chi tiết active=false,
   đơn set trangthai='-1' + pheduyet='-1' + active=false.
   Nguồn: proc-bodies/tr_dondathang_cancel.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trDondathangCancel(
  db: DB,
  companyId: string,
  args: { maddh: string },
): Promise<Array<{ updated_chitiet: number; updated_don: number }>> {
  if (!args.maddh) throw new Error("Thiếu maddh");

  const tCt = await procTable(db, companyId, "tr_dondathang_chitiet");
  const updatedChitiet = await tCt.updateWhere(
    { active: false },
    sql`${tCt.text("maddh")} = ${args.maddh}`,
  );

  const t = await procTable(db, companyId, "tr_dondathang");
  const updatedDon = await t.updateWhere(
    { trangthai: "-1", pheduyet: "-1", active: false },
    sql`${t.text("maddh")} = ${args.maddh}`,
  );

  return [{ updated_chitiet: updatedChitiet, updated_don: updatedDon }];
}
