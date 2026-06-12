/* Port pb_chitiet_phieubuhang_UPDATESL — cập nhật số lượng đã xử lý
   của 1 dòng chi tiết phiếu bù hàng theo id_chitiet_phieubu.
   PK nguồn uniqueidentifier → so sánh text.
   Nguồn: migration-plan/ui/proc-bodies/pb_chitiet_phieubuhang_updatesl.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function pbChitietPhieubuhangUpdatesl(
  db: DB,
  companyId: string,
  args: { id: string; soluongdaxuly: number },
): Promise<Array<{ updated: number }>> {
  if (!args.id) throw new Error("Thiếu id");
  if (args.soluongdaxuly == null) throw new Error("Thiếu soluongdaxuly");

  const t = await procTable(db, companyId, "pb_chitiet_phieubuhang");
  const updated = await t.updateWhere(
    { soluongdaxuly: args.soluongdaxuly },
    sql`${t.text("id_chitiet_phieubu")} = ${args.id}`,
  );
  return [{ updated }];
}
