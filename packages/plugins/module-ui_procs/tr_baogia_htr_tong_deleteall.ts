/* Port TR_BAOGIA_HTR_TONG_DELETEALL — xoá toàn bộ dòng tổng hậu trường
   (bảng tr_baogia_htr_tong) của 1 báo giá. DELETE gốc → soft-delete
   (chuẩn hệ mới). Nguồn: proc-bodies/tr_baogia_htr_tong_deleteall.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trBaogiaHtrTongDeleteall(
  db: DB,
  companyId: string,
  args: { baogiaid: string },
): Promise<number> {
  if (!args.baogiaid) throw new Error("Thiếu baogiaid");
  const t = await procTable(db, companyId, "tr_baogia_htr_tong");
  return t.softDeleteWhere(sql`${t.text("baogiaid")} = ${args.baogiaid}`);
}
