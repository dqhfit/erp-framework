/* Port TR_DINHMUC_SON_THEOMAU_DELETEALL — xoá toàn bộ định mức sơn
   theo mã màu.
   Nguồn: migration-plan/ui/proc-bodies/tr_dinhmuc_son_theomau_deleteall.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trDinhmucSonTheomauDeleteall(
  db: DB,
  companyId: string,
  args: { mamau: string },
): Promise<number> {
  if (!args.mamau) throw new Error("Thiếu mamau");

  const t = await procTable(db, companyId, "tr_dinhmuc_son_theomau");
  // Proc gốc: DELETE tr_dinhmuc_son_theomau WHERE mamau = @mamau.
  // Hệ mới dùng soft-delete (deleted_at) cho bảng thật — chuẩn thay cho DELETE.
  return t.softDeleteWhere(sql`${t.text("mamau")} = ${args.mamau}`);
}
