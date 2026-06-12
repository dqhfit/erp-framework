/* Port TR_DEXUAT_BANGMAU_CANCEL — huỷ đề xuất bảng màu (set active=false
   cả phiếu lẫn chi tiết). Nguồn: proc-bodies/tr_dexuat_bangmau_cancel.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trDexuatBangmauCancel(
  db: DB,
  companyId: string,
  args: { id: string },
): Promise<Array<{ updated_chitiet: number; updated_phieu: number }>> {
  if (!args.id) throw new Error("Thiếu id");

  const tCt = await procTable(db, companyId, "tr_dexuat_bangmau_chitiet");
  const updatedChitiet = await tCt.updateWhere(
    { active: false },
    sql`${tCt.text("dexuat_id")} = ${args.id}`,
  );

  const t = await procTable(db, companyId, "tr_dexuat_bangmau");
  const updatedPhieu = await t.updateWhere({ active: false }, sql`${t.text("id")} = ${args.id}`);

  return [{ updated_chitiet: updatedChitiet, updated_phieu: updatedPhieu }];
}
