/* Port TR_PHIEUYEUCAU_CANCEL — huỷ phiếu yêu cầu theo SỐ PHIẾU (int):
   active=false + cờ bgd_cancel + lý do. Nguồn: proc-bodies/tr_phieuyeucau_cancel.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trPhieuyeucauCancel(
  db: DB,
  companyId: string,
  args: {
    sophieu: number;
    bgd_cancel: boolean;
    description_cancel?: string | null;
  },
): Promise<Array<{ updated: number }>> {
  if (args.sophieu == null) throw new Error("Thiếu sophieu");

  const t = await procTable(db, companyId, "tr_phieuyeucau");
  const updated = await t.updateWhere(
    {
      active: false,
      bgd_cancel: args.bgd_cancel ?? false,
      description_cancel: args.description_cancel ?? null,
    },
    sql`${t.num("sophieu")} = ${args.sophieu}`,
  );
  return [{ updated }];
}
