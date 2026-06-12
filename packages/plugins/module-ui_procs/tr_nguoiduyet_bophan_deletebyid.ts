/* Port TR_NGUOIDUYET_BOPHAN_DELETEBYID — xoá người duyệt bộ phận theo id.
   DELETE gốc → soft-delete (chuẩn hệ mới). Nguồn: proc-bodies/tr_nguoiduyet_bophan_deletebyid.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trNguoiduyetBophanDeletebyid(
  db: DB,
  companyId: string,
  args: { id: string },
): Promise<number> {
  if (!args.id) throw new Error("Thiếu id");

  const t = await procTable(db, companyId, "tr_nguoiduyet_bophan");
  return t.softDeleteWhere(sql`${t.text("id")} = ${args.id}`);
}
