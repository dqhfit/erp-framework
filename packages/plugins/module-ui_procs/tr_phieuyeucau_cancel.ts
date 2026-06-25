/* Port TR_PHIEUYEUCAU_CANCEL — huỷ phiếu yêu cầu theo SỐ PHIẾU (int):
   active=false + cờ bgd_cancel + lý do. Nguồn: proc-bodies/tr_phieuyeucau_cancel.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trPhieuyeucauCancel(
  db: DB,
  companyId: string,
  args: {
    sophieu?: number;
    _id?: string;
    bgd_cancel: boolean;
    description_cancel?: string | null;
  },
): Promise<Array<{ updated: number }>> {
  if (args.sophieu == null && !args._id) throw new Error("Thiếu sophieu");

  const t = await procTable(db, companyId, "tr_phieuyeucau");

  // Nếu có _id (uuid vật lý từ rowAction) → tra dòng head lấy sophieu rồi chạy logic cũ.
  let sophieu = args.sophieu;
  if (args._id != null) {
    const [head] = await t.listWhere(sql`id = ${args._id}::uuid`, { limit: 1 });
    if (!head) throw new Error("Không tìm thấy phiếu yêu cầu");
    sophieu = Number(head.sophieu);
    if (!Number.isFinite(sophieu)) throw new Error("sophieu không hợp lệ");
  }

  const updated = await t.updateWhere(
    {
      active: false,
      bgd_cancel: args.bgd_cancel ?? false,
      description_cancel: args.description_cancel ?? null,
    },
    sql`${t.num("sophieu")} = ${sophieu}`,
  );
  return [{ updated }];
}
