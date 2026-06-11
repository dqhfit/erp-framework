import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

// @type = 1: Trưởng bộ phận duyệt; @type = 2: Ban giám đốc duyệt
export async function trDexuatBangmauConfirm(
  db: DB,
  companyId: string,
  args: {
    id: string;
    type: number;
    nguoiduyet: string;
    ngayduyet: Date | string;
  },
): Promise<Array<{ updated: number }>> {
  if (!args.id) throw new Error("Thiếu id");
  if (!args.type) throw new Error("Thiếu type");
  if (!args.nguoiduyet) throw new Error("Thiếu nguoiduyet");
  if (!args.ngayduyet) throw new Error("Thiếu ngayduyet");

  const ngayduyet = args.ngayduyet instanceof Date ? args.ngayduyet : new Date(args.ngayduyet);

  if (args.type === 1) {
    // Trưởng bộ phận duyệt
    const r = await db.execute<{ updated: number }>(sql`
      UPDATE tr_dexuat_bangmau
      SET truongbophan_duyet      = ${args.nguoiduyet},
          truongbophan_ngayduyet  = ${ngayduyet},
          updated_at              = now()
      WHERE id          = ${args.id}
        AND company_id  = ${companyId}
        AND deleted_at  IS NULL
    `);
    return r as unknown as Array<{ updated: number }>;
  }

  if (args.type === 2) {
    // Ban giám đốc duyệt
    const r = await db.execute<{ updated: number }>(sql`
      UPDATE tr_dexuat_bangmau
      SET bangiamdoc_duyet      = ${args.nguoiduyet},
          bangiamdoc_ngayduyet  = ${ngayduyet},
          updated_at            = now()
      WHERE id          = ${args.id}
        AND company_id  = ${companyId}
        AND deleted_at  IS NULL
    `);
    return r as unknown as Array<{ updated: number }>;
  }

  throw new Error(`type không hợp lệ: ${args.type} (chỉ nhận 1 hoặc 2)`);
}
