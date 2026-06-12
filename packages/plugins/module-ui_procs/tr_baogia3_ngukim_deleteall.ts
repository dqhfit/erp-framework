/* Port TR_BAOGIA3_NGUKIM_DELETEALL — xoá toàn bộ dòng ngũ kim (bảng
   tr_baogia3_ngukim) của 1 báo giá. DELETE gốc → soft-delete (chuẩn hệ mới).
   Nguồn: proc-bodies/tr_baogia3_ngukim_deleteall.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trBaogia3NgukimDeleteall(
  db: DB,
  companyId: string,
  args: { baogiaid: string },
): Promise<number> {
  if (!args.baogiaid) throw new Error("Thiếu baogiaid");
  const t = await procTable(db, companyId, "tr_baogia3_ngukim");
  return t.softDeleteWhere(sql`${t.text("baogiaid")} = ${args.baogiaid}`);
}
