/* Port TR_PHIEUYEUCAU_CANCEL2 — huỷ phiếu yêu cầu theo ID (uniqueidentifier):
   chi tiết + phiếu cùng set active=false. Nguồn: proc-bodies/tr_phieuyeucau_cancel2.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trPhieuyeucauCancel2(
  db: DB,
  companyId: string,
  args: { id: string },
): Promise<Array<{ updated_chitiet: number; updated_phieu: number }>> {
  if (!args.id) throw new Error("Thiếu id");

  const tCt = await procTable(db, companyId, "tr_phieuyeucau_chitiet");
  const updatedChitiet = await tCt.updateWhere(
    { active: false },
    sql`${tCt.text("phieuyeucau_id")} = ${args.id}`,
  );

  const t = await procTable(db, companyId, "tr_phieuyeucau");
  const updatedPhieu = await t.updateWhere({ active: false }, sql`${t.text("id")} = ${args.id}`);

  return [{ updated_chitiet: updatedChitiet, updated_phieu: updatedPhieu }];
}
