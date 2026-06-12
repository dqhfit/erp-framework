/* Port TR_COMMERCIAL_INVOICE_DETAIL_DELETEBYID — "xoá" dòng chi tiết
   commercial invoice theo detailid (uniqueidentifier nguồn).
   CHÚ Ý: proc gốc KHÔNG DELETE — chỉ UPDATE SET Actived = 0 (flag-deactivate
   theo nghiệp vụ, dữ liệu vẫn nằm trong bảng cho list query lọc actived=1)
   → port bằng updateWhere actived=false, KHÔNG dùng softDeleteWhere
   (deleted_at sẽ ẩn row khỏi mọi query qua scope — sai semantic nguồn).
   Nguồn: migration-plan/ui/proc-bodies/tr_commercial_invoice_detail_deletebyid.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trCommercialInvoiceDetailDeletebyid(
  db: DB,
  companyId: string,
  args: { detailid: string },
): Promise<Array<{ updated: number }>> {
  if (!args.detailid) throw new Error("Thiếu detailid");

  const t = await procTable(db, companyId, "tr_commercial_invoice_detail");
  const updated = await t.updateWhere(
    { actived: false },
    sql`${t.text("detailid")} = ${args.detailid}`,
  );
  return [{ updated }];
}
