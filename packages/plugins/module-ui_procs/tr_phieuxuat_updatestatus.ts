import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

export async function trPhieuxuatUpdatestatus(
  db: DB,
  companyId: string,
  args: {
    so_px: string;
    active: boolean;
  },
): Promise<Array<Record<string, never>>> {
  if (!args.so_px) throw new Error("Thiếu so_px");

  await db.execute(sql`
    UPDATE tr_phieuxuat
    SET    active     = ${args.active},
           updated_at = now()
    WHERE  company_id = ${companyId}
      AND  sopx       = ${args.so_px}
      AND  deleted_at IS NULL
  `);

  return [];
}
