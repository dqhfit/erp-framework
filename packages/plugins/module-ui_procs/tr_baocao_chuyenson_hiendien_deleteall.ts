/* Port TR_BAOCAO_CHUYENSON_HIENDIEN_DELETEALL — xoá toàn bộ hiện diện
   của 1 báo cáo chuyền sơn theo id báo cáo.
   Nguồn: migration-plan/ui/proc-bodies/tr_baocao_chuyenson_hiendien_deleteall.sql
   DELETE gốc → soft-delete (chuẩn hệ mới). PK nguồn uniqueidentifier → so sánh text. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trBaocaoChuyensonHiendienDeleteall(
  db: DB,
  companyId: string,
  args: {
    id_baocao: string;
  },
): Promise<number> {
  if (!args.id_baocao) throw new Error("Thiếu id_baocao");

  const t = await procTable(db, companyId, "tr_baocao_chuyenson_hiendien");
  // Proc gốc: DELETE tr_baocao_chuyenson_hiendien WHERE id_baocao = @id_baocao
  return t.softDeleteWhere(sql`${t.text("id_baocao")} = ${args.id_baocao}`);
}
