/* Port TR_DEXUAT_BANGMAU_CONFIRM — duyệt đề xuất bảng mẫu.
   Nguồn: migration-plan/ui/proc-bodies/tr_dexuat_bangmau_confirm.sql
   Ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   f_... hoặc ext của bảng thật, tự version/updated_at, guard mirror).
   type = 1: trưởng bộ phận duyệt; type = 2: ban giám đốc duyệt.
   PK nguồn uniqueidentifier → so sánh qua field "id" (text). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

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

  const ngayduyet =
    args.ngayduyet instanceof Date
      ? args.ngayduyet.toISOString()
      : new Date(args.ngayduyet).toISOString();

  const t = await procTable(db, companyId, "tr_dexuat_bangmau");
  const where = sql`${t.text("id")} = ${args.id}`;

  if (args.type === 1) {
    // Trưởng bộ phận duyệt
    const updated = await t.updateWhere(
      { truongbophan_duyet: args.nguoiduyet, truongbophan_ngayduyet: ngayduyet },
      where,
    );
    return [{ updated }];
  }

  if (args.type === 2) {
    // Ban giám đốc duyệt
    const updated = await t.updateWhere(
      { bangiamdoc_duyet: args.nguoiduyet, bangiamdoc_ngayduyet: ngayduyet },
      where,
    );
    return [{ updated }];
  }

  throw new Error(`type không hợp lệ: ${args.type} (chỉ nhận 1 hoặc 2)`);
}
