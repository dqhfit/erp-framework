/* Port TR_BANVE_UPDATE3 — cập nhật bản vẽ theo id nguồn (int).
   Nguồn: migration-plan/ui/proc-bodies/tr_banve_update3.sql
   Ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   f_... hoặc ext của bảng thật, tự version/updated_at/search_tsv, guard mirror).
   Proc gốc KHÔNG update create_by/create_date — giữ nguyên. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trBanveUpdate3(
  db: DB,
  companyId: string,
  args: {
    id: number;
    masp: string;
    tensp: string;
    khachhang: string;
    hehang: string;
    filepath: string;
    seq1: string;
    seq2: string;
    banve_donggoi: boolean;
    banve_govan: boolean;
    phanloai: string;
    update_by: string;
    update_date: Date;
    active: boolean;
  },
): Promise<void> {
  if (!args.id) throw new Error("Thiếu id");

  const t = await procTable(db, companyId, "tr_banve");
  // PK nguồn id là FIELD (int) — so sánh qua t.num, KHÔNG đụng uuid row
  await t.updateWhere(
    {
      masp: args.masp,
      tensp: args.tensp,
      khachhang: args.khachhang,
      hehang: args.hehang,
      filepath: args.filepath,
      seq1: args.seq1,
      seq2: args.seq2,
      banve_donggoi: args.banve_donggoi,
      banve_govan: args.banve_govan,
      phanloai: args.phanloai,
      update_by: args.update_by,
      update_date:
        args.update_date instanceof Date
          ? args.update_date.toISOString()
          : (args.update_date ?? null),
      active: args.active,
    },
    sql`${t.num("id")} = ${args.id}`,
  );
}
