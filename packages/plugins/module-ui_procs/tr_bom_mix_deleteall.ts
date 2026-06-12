/* Port TR_BOM_MIX_DELETEALL — xoá toàn bộ dòng BOM mix theo mã chi tiết mix.
   Nguồn: migration-plan/ui/proc-bodies/tr_bom_mix_deleteall.sql

   Bảng tr_bom_mix mới import (import-items-composite.json) — mapping cột
   vật lý đọc từ meta.storage lúc runtime qua procTable. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trBomMixDeleteall(
  db: DB,
  companyId: string,
  args: { mact_mix: string },
): Promise<number> {
  if (!args.mact_mix) throw new Error("Thiếu mact_mix");

  const t = await procTable(db, companyId, "tr_bom_mix");
  // Proc gốc: DELETE tr_bom_mix WHERE mact_mix = @mact_mix.
  // Hệ mới dùng soft-delete (deleted_at) cho bảng thật — chuẩn thay cho DELETE.
  return t.softDeleteWhere(sql`${t.text("mact_mix")} = ${args.mact_mix}`);
}
