/* Port TR_BAOGIA_HTR_GOVAN_DELETEALL — xoá toàn bộ dòng gỗ ván hậu trường
   (bảng tr_baogia_htr_govan) của 1 báo giá. DELETE gốc → soft-delete
   (chuẩn hệ mới). Nguồn: proc-bodies/tr_baogia_htr_govan_deleteall.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trBaogiaHtrGovanDeleteall(
  db: DB,
  companyId: string,
  args: { baogiaid: string },
): Promise<number> {
  if (!args.baogiaid) throw new Error("Thiếu baogiaid");
  const t = await procTable(db, companyId, "tr_baogia_htr_govan");
  return t.softDeleteWhere(sql`${t.text("baogiaid")} = ${args.baogiaid}`);
}
