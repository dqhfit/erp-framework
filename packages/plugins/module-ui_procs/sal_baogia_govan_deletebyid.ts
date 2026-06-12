/* Port SAL_BAOGIA_GOVAN_DELETEBYID — xoá cả báo giá gỗ ván: toàn bộ
   chi tiết (sal_baogia_govan_chitiet) + dòng head (sal_baogia_govan)
   theo idbaogia.
   Nguồn: migration-plan/ui/proc-bodies/sal_baogia_govan_deletebyid.sql
   DELETE gốc → soft-delete (chuẩn hệ mới). idbaogia uniqueidentifier →
   so sánh text. Thứ tự giữ như proc gốc: chitiet trước, head sau. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function salBaogiaGovanDeletebyid(
  db: DB,
  companyId: string,
  args: {
    idbaogia: string;
  },
): Promise<Record<string, number>> {
  if (!args.idbaogia) throw new Error("Thiếu idbaogia");

  const out: Record<string, number> = {};

  // 1) Xoá chi tiết theo idbaogia
  const tChitiet = await procTable(db, companyId, "sal_baogia_govan_chitiet");
  out.sal_baogia_govan_chitiet = await tChitiet.softDeleteWhere(
    sql`${tChitiet.text("idbaogia")} = ${args.idbaogia}`,
  );

  // 2) Xoá head theo idbaogia
  const tHead = await procTable(db, companyId, "sal_baogia_govan");
  out.sal_baogia_govan = await tHead.softDeleteWhere(
    sql`${tHead.text("idbaogia")} = ${args.idbaogia}`,
  );

  return out;
}
