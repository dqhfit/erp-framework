/* Port TR_MATERIAL_UPDATE3 — xác nhận vật tư (xacnhan + người + ngày)
   theo mavt. Nguồn: proc-bodies/tr_material_update3.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trMaterialUpdate3(
  db: DB,
  companyId: string,
  args: {
    mavt: string;
    xacnhan?: boolean | null;
    nguoixacnhan?: string | null;
    ngayxacnhan?: string | null;
  },
): Promise<Array<{ updated: number }>> {
  if (!args.mavt) throw new Error("Thiếu mavt");

  const t = await procTable(db, companyId, "tr_material");
  const updated = await t.updateWhere(
    {
      xacnhan: args.xacnhan ?? false,
      nguoixacnhan: args.nguoixacnhan ?? "",
      ngayxacnhan: args.ngayxacnhan ?? null,
    },
    sql`${t.text("mavt")} = ${args.mavt}`,
  );
  return [{ updated }];
}
