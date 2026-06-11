/* Port TR_DINHMUC_LOCK_GET2 — đọc bản ghi khoá định mức của sản phẩm:
   bước 1 tra masp từ tr_sanpham theo (masp_nhamay, mausac), bước 2 đọc
   tr_dinhmuc_lock theo (masp, loaidinhmuc).
   Nguồn: migration-plan/ui/proc-bodies/tr_dinhmuc_lock_get2.sql

   CHÚ Ý: bảng tr_dinhmuc_lock CHƯA migrate sang PG — proc sẽ throw
   'entity không tồn tại' khi gọi (tới được bước 2) cho tới khi bảng được
   migrate. Bảng không có trong field-map nên tên field giữ theo T-SQL
   gốc lowercase (masp, loaidinhmuc).

   2 bảng → tách 2 query + ghép trong JS (batch-stitch), không join 1 câu. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trDinhmucLockGet2(
  db: DB,
  companyId: string,
  args: {
    masp_nhamay: string;
    mausac?: string | null;
    loaidinhmuc?: string | null;
  },
): Promise<Array<Record<string, unknown>>> {
  if (!args.masp_nhamay) throw new Error("Thiếu masp_nhamay");

  // Bước 1: tra masp từ tr_sanpham (T-SQL SELECT @masp = masp → lấy 1 dòng)
  const sp = await procTable(db, companyId, "tr_sanpham");
  const spRows = await sp.listWhere(
    sql`${sp.text("masp_nhamay")} = ${args.masp_nhamay}
        AND ${sp.text("mausac")} = ${args.mausac ?? null}`,
    { limit: 1 },
  );
  const masp = spRows[0]?.masp;
  // Không tìm thấy sản phẩm → @masp NULL → WHERE masp = NULL khớp 0 dòng (gốc)
  if (masp == null) return [];

  // Bước 2: đọc tr_dinhmuc_lock (SELECT * gốc → trả mọi field + _id)
  const lock = await procTable(db, companyId, "tr_dinhmuc_lock");
  return lock.listWhere(
    sql`${lock.text("masp")} = ${String(masp)}
        AND ${lock.text("loaidinhmuc")} = ${args.loaidinhmuc ?? null}`,
  );
}
