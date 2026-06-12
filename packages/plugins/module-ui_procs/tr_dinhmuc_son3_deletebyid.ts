/* Port TR_DINHMUC_SON3_DELETEBYID — xoá 1 dòng định mức sơn 3 theo id.
   DELETE gốc → soft-delete (chuẩn hệ mới). Nguồn: proc-bodies/tr_dinhmuc_son3_deletebyid.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trDinhmucSon3Deletebyid(
  db: DB,
  companyId: string,
  args: { id: string },
): Promise<number> {
  if (!args.id) throw new Error("Thiếu id");

  const t = await procTable(db, companyId, "tr_dinhmuc_son3");
  return t.softDeleteWhere(sql`${t.text("id")} = ${args.id}`);
}
