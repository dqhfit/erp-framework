/* Port TR_QUYTRINH_YEUCAU_CHATLUONG_DELETEBYID — "xoá" 1 yêu cầu chất lượng
   theo id (PK int). Proc gốc KHÔNG DELETE mà set cờ nghiệp vụ active = 0
   (ẩn khỏi danh sách) — giữ nguyên ngữ nghĩa: updateWhere active = 0,
   KHÔNG dùng deleted_at để logic đọc theo active của hệ cũ vẫn đúng.
   Nguồn: migration-plan/ui/proc-bodies/tr_quytrinh_yeucau_chatluong_deletebyid.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trQuytrinhYeucauChatluongDeletebyid(
  db: DB,
  companyId: string,
  args: {
    id: number;
  },
): Promise<Array<{ updated: number }>> {
  if (args.id == null) throw new Error("Thiếu id");

  const t = await procTable(db, companyId, "tr_quytrinh_yeucau_chatluong");
  const updated = await t.updateWhere({ active: 0 }, sql`${t.num("id")} = ${args.id}`);
  return [{ updated }];
}
