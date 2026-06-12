/* Port TR_BAOCAO_CHUYENSON_CHITIET_DELETE2 — xoá chi tiết báo cáo chuyền sơn
   theo id báo cáo + mã công đoạn.
   Nguồn: migration-plan/ui/proc-bodies/tr_baocao_chuyenson_chitiet_delete2.sql
   DELETE gốc → soft-delete (chuẩn hệ mới). PK nguồn uniqueidentifier → so sánh text. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trBaocaoChuyensonChitietDelete2(
  db: DB,
  companyId: string,
  args: {
    id_baocao: string;
    macongdoan: string;
  },
): Promise<number> {
  if (!args.id_baocao) throw new Error("Thiếu id_baocao");
  if (!args.macongdoan) throw new Error("Thiếu macongdoan");

  const t = await procTable(db, companyId, "tr_baocao_chuyenson_chitiet");
  // Proc gốc: DELETE tr_baocao_chuyenson_chitiet
  //   WHERE id_baocao = @id_baocao AND macongdoan = @macongdoan
  return t.softDeleteWhere(
    sql`${t.text("id_baocao")} = ${args.id_baocao} AND ${t.text("macongdoan")} = ${args.macongdoan}`,
  );
}
