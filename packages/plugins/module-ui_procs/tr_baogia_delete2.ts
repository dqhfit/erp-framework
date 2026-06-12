/* Port TR_BAOGIA_DELETE2 — xoá toàn bộ dòng báo giá của 1 sản phẩm trong
   1 báo giá (7 bảng tr_baogia_*). DELETE gốc → soft-delete (chuẩn hệ mới).
   Nguồn: proc-bodies/tr_baogia_delete2.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trBaogiaDelete2(
  db: DB,
  companyId: string,
  args: { masp: string; baogiaid: string },
): Promise<Record<string, number>> {
  if (!args.masp) throw new Error("Thiếu masp");
  if (!args.baogiaid) throw new Error("Thiếu baogiaid");

  const out: Record<string, number> = {};

  // 5 bảng xoá theo masp + baogiaid
  for (const name of [
    "tr_baogia_govan",
    "tr_baogia_ngukim",
    "tr_baogia_donggoi",
    "tr_baogia_son",
    "tr_baogia_thanhpham",
  ]) {
    const t = await procTable(db, companyId, name);
    out[name] = await t.softDeleteWhere(
      sql`${t.text("masp")} = ${args.masp} AND ${t.text("baogiaid")} = ${args.baogiaid}`,
    );
  }

  // 2 bảng xoá chỉ theo baogiaid (proc gốc không lọc masp)
  for (const name of ["tr_baogia_other", "tr_baogia_govan_giacong"]) {
    const t = await procTable(db, companyId, name);
    out[name] = await t.softDeleteWhere(sql`${t.text("baogiaid")} = ${args.baogiaid}`);
  }

  return out;
}
