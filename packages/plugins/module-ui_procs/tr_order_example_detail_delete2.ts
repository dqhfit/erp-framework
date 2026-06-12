/* Port TR_ORDER_EXAMPLE_DETAIL_DELETE2 — xoá dòng chi tiết đơn hàng mẫu
   theo id nguồn (int). Proc gốc DELETE thật; hệ mới chuẩn soft-delete
   (deleted_at) cho bảng thật.
   Nguồn: migration-plan/ui/proc-bodies/tr_order_example_detail_delete2.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trOrderExampleDetailDelete2(
  db: DB,
  companyId: string,
  args: { id: number },
): Promise<number> {
  if (args.id == null) throw new Error("Thiếu id");

  const t = await procTable(db, companyId, "tr_order_example_detail");
  return t.softDeleteWhere(sql`${t.num("id")} = ${args.id}`);
}
