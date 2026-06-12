/* Port TR_MATERIAL_OTHER_DELETEBYCODE — xoá vật tư "khác" theo mã:
   1. UPDATE tr_material SET xoa = 'N' WHERE mavt = @mact — GIỮ NGUYÊN theo
      proc gốc (set cờ xoa về 'N', tức KHÔNG đánh dấu xoá vật tư gốc;
      dòng DELETE tr_material trong body gốc đã bị comment).
   2. Xoá tr_material_other theo mact + tr_tonkho_sum/tr_tonkho_chitiet
      theo mavt (proc gốc DELETE thật — hệ mới chuẩn soft-delete).
   Nguồn: migration-plan/ui/proc-bodies/tr_material_other_deletebycode.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trMaterialOtherDeletebycode(
  db: DB,
  companyId: string,
  args: { mact: string },
): Promise<
  Array<{
    updated: number;
    deleted_other: number;
    deleted_tonkho_sum: number;
    deleted_tonkho_chitiet: number;
  }>
> {
  if (!args.mact) throw new Error("Thiếu mact");

  const tVt = await procTable(db, companyId, "tr_material");
  const updated = await tVt.updateWhere({ xoa: "N" }, sql`${tVt.text("mavt")} = ${args.mact}`);

  const tOther = await procTable(db, companyId, "tr_material_other");
  const deletedOther = await tOther.softDeleteWhere(sql`${tOther.text("mact")} = ${args.mact}`);

  const tSum = await procTable(db, companyId, "tr_tonkho_sum");
  const deletedSum = await tSum.softDeleteWhere(sql`${tSum.text("mavt")} = ${args.mact}`);

  const tCt = await procTable(db, companyId, "tr_tonkho_chitiet");
  const deletedChitiet = await tCt.softDeleteWhere(sql`${tCt.text("mavt")} = ${args.mact}`);

  return [
    {
      updated,
      deleted_other: deletedOther,
      deleted_tonkho_sum: deletedSum,
      deleted_tonkho_chitiet: deletedChitiet,
    },
  ];
}
