/* Port TR_KEHOACH_HANGTRANG_CHITIET_CONFIRM — set cờ xác nhận cho 1 dòng
   chi tiết kế hoạch hàng trắng theo id_chitiet (uniqueidentifier nguồn).
   Nguồn: migration-plan/ui/proc-bodies/tr_kehoach_hangtrang_chitiet_confirm.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trKehoachHangtrangChitietConfirm(
  db: DB,
  companyId: string,
  args: {
    id_chitiet: string;
    xacnhan: boolean;
  },
): Promise<Array<{ updated: number }>> {
  if (!args.id_chitiet) throw new Error("Thiếu id_chitiet");
  if (args.xacnhan == null) throw new Error("Thiếu xacnhan");

  const t = await procTable(db, companyId, "tr_kehoach_hangtrang_chitiet");
  const updated = await t.updateWhere(
    { xacnhan: args.xacnhan },
    sql`${t.text("id_chitiet")} = ${args.id_chitiet}`,
  );
  return [{ updated }];
}
