/* Port TR_NHACC_UPDATE2 — cập nhật nhà cung cấp theo id nguồn (int).
   Nguồn: migration-plan/ui/proc-bodies/tr_nhacc_update2.sql
   Ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   f_... hoặc ext của bảng thật, tự version/updated_at/search_tsv, guard mirror).
   Proc gốc KHÔNG update create_by/create_date — giữ nguyên. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trNhaccUpdate2(
  db: DB,
  companyId: string,
  args: {
    id: number;
    vendor_id: string;
    vendor_name: string;
    address?: string | null;
    area?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    loaincc?: number | null;
    sotaikhoan?: string | null;
    tentaikhoan?: string | null;
    tennganhang?: string | null;
  },
): Promise<{ updated: number }> {
  if (!args.id) throw new Error("Thiếu id");

  const t = await procTable(db, companyId, "tr_nhacc");
  // PK nguồn id là FIELD (int) — so sánh qua t.num, KHÔNG đụng uuid row
  const updated = await t.updateWhere(
    {
      vendor_id: args.vendor_id,
      vendor_name: args.vendor_name,
      address: args.address ?? null,
      area: args.area ?? null,
      phone: args.phone ?? null,
      email: args.email ?? null,
      website: args.website ?? null,
      loaincc: args.loaincc ?? null,
      sotaikhoan: args.sotaikhoan ?? null,
      tentaikhoan: args.tentaikhoan ?? null,
      tennganhang: args.tennganhang ?? null,
    },
    sql`${t.num("id")} = ${args.id}`,
  );

  return { updated };
}
