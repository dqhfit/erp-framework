/* Port TR_CTPHIEUXUAT_UPDATE2 — cập nhật chi tiết phiếu xuất theo id nguồn (int).
   Nguồn: migration-plan/ui/proc-bodies/tr_ctphieuxuat_update2.sql
   Ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   f_... hoặc ext của bảng thật, tự version/updated_at/search_tsv, guard mirror).
   LƯU Ý: @ngaytao + @nguoitao trong proc gốc được khai báo nhưng KHÔNG nằm
   trong câu UPDATE — bỏ qua có chủ ý (giữ nguyên hành vi nguồn). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trCtphieuxuatUpdate2(
  db: DB,
  companyId: string,
  args: {
    id: number;
    lenhcapphat?: string | null;
    phieuxuat?: string | null;
    makho?: string | null;
    mact?: string | null;
    soluong?: number | null;
    ghichu?: string | null;
    ngaytao?: string | null;
    nguoitao?: string | null;
    id_pyc_chitiet?: string | null;
    id_chitiet_dathang?: number | null;
    id_chitiet_lcp?: number | null;
  },
): Promise<void> {
  if (!args.id) throw new Error("Thiếu id");

  const t = await procTable(db, companyId, "tr_ctphieuxuat");
  // PK nguồn id là FIELD (int) — so sánh qua t.num, KHÔNG đụng uuid row
  await t.updateWhere(
    {
      lenhcapphat: args.lenhcapphat ?? null,
      phieuxuat: args.phieuxuat ?? null,
      makho: args.makho ?? null,
      mact: args.mact ?? null,
      soluong: args.soluong ?? null,
      ghichu: args.ghichu ?? null,
      id_pyc_chitiet: args.id_pyc_chitiet ?? null,
      id_chitiet_dathang: args.id_chitiet_dathang ?? null,
      id_chitiet_lcp: args.id_chitiet_lcp ?? null,
    },
    sql`${t.num("id")} = ${args.id}`,
  );
}
