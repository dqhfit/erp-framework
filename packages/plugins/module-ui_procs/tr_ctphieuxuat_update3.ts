/* Port TR_CTPHIEUXUAT_UPDATE3 — cập nhật nhanh số lượng/ghi chú chi tiết
   phiếu xuất theo id nguồn (int), kèm người sửa + ngày sửa.
   Nguồn: migration-plan/ui/proc-bodies/tr_ctphieuxuat_update3.sql
   Ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   f_... hoặc ext của bảng thật, tự version/updated_at/search_tsv, guard mirror). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trCtphieuxuatUpdate3(
  db: DB,
  companyId: string,
  args: {
    id: number;
    soluong?: number | null;
    ghichu?: string | null;
    ngaysua?: string | null;
    nguoisua?: string | null;
  },
): Promise<void> {
  if (!args.id) throw new Error("Thiếu id");

  const t = await procTable(db, companyId, "tr_ctphieuxuat");
  // PK nguồn id là FIELD (int) — so sánh qua t.num, KHÔNG đụng uuid row
  await t.updateWhere(
    {
      soluong: args.soluong ?? null,
      ghichu: args.ghichu ?? null,
      nguoisua: args.nguoisua ?? null,
      ngaysua: args.ngaysua ?? null,
    },
    sql`${t.num("id")} = ${args.id}`,
  );
}
