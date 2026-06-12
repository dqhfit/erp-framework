/* Port TR_DINHMUC_SON_THEOMAU_INSERT2 — thêm 1 dòng định mức sơn theo màu.
   Nguồn: migration-plan/ui/proc-bodies/tr_dinhmuc_son_theomau_insert2.sql
   Ghi qua procTable (đúng cột vật lý f_... hoặc ext của bảng thật,
   tự version/updated_at/search_tsv, guard mirror).
   T-SQL: @dongia/@thanhtien có default = 0 — giữ nguyên ngữ nghĩa. */
import type { DB } from "@erp-framework/server/db";
import { procTable } from "../src/proc-table";

export async function trDinhmucSonTheomauInsert2(
  db: DB,
  companyId: string,
  args: {
    mamau: string;
    stt?: string | null;
    buoc?: string | null;
    mact?: string | null;
    tenct?: string | null;
    soluong?: number | null;
    ngayquytrinh?: string | null;
    nguoitao?: string | null;
    ngaytao?: string | null;
    nguoisua?: string | null;
    ngaysua?: string | null;
    dongia?: number | null;
    thanhtien?: number | null;
    t_sort?: number | null;
  },
): Promise<Array<{ id: string }>> {
  if (!args.mamau) throw new Error("Thiếu mamau");

  const t = await procTable(db, companyId, "tr_dinhmuc_son_theomau");
  const id = await t.insertRow({
    mamau: args.mamau,
    stt: args.stt ?? null,
    buoc: args.buoc ?? null,
    mact: args.mact ?? null,
    tenct: args.tenct ?? null,
    soluong: args.soluong ?? null,
    ngayquytrinh: args.ngayquytrinh ?? null,
    nguoitao: args.nguoitao ?? null,
    ngaytao: args.ngaytao ?? null,
    nguoisua: args.nguoisua ?? null,
    ngaysua: args.ngaysua ?? null,
    dongia: args.dongia ?? 0,
    thanhtien: args.thanhtien ?? 0,
    t_sort: args.t_sort ?? null,
  });

  return [{ id }];
}
