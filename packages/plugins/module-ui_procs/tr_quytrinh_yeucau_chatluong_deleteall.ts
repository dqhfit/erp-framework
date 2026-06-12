/* Port TR_QUYTRINH_YEUCAU_CHATLUONG_DELETEALL — "xoá" toàn bộ yêu cầu
   chất lượng của 1 công đoạn. Proc gốc KHÔNG DELETE mà set cờ nghiệp vụ
   active = 0 cho mọi row khớp macongdoan — giữ nguyên ngữ nghĩa:
   updateWhere active = 0, KHÔNG dùng deleted_at.
   Nguồn: migration-plan/ui/proc-bodies/tr_quytrinh_yeucau_chatluong_deleteall.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trQuytrinhYeucauChatluongDeleteall(
  db: DB,
  companyId: string,
  args: {
    macongdoan: string;
  },
): Promise<Array<{ updated: number }>> {
  if (!args.macongdoan) throw new Error("Thiếu macongdoan");

  const t = await procTable(db, companyId, "tr_quytrinh_yeucau_chatluong");
  const updated = await t.updateWhere(
    { active: 0 },
    sql`${t.text("macongdoan")} = ${args.macongdoan}`,
  );
  return [{ updated }];
}
