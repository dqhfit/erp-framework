/* Port TR_DENGHI_THANHTOAN_DUYET — duyệt đề nghị thanh toán.
   Nguồn: migration-plan/ui/proc-bodies/tr_denghi_thanhtoan_duyet.sql
   Ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   f_... hoặc ext của bảng thật, tự version/updated_at, guard mirror).
   type = 0: trưởng bộ phận duyệt (truongbophan + ngayduyet2);
   type = 1: ban giám đốc duyệt (nguoiduyet + ngayduyet).
   type khác: no-op như T-SQL gốc (không có nhánh ELSE).
   PK nguồn uniqueidentifier → so sánh qua field "id" (text). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trDenghiThanhtoanDuyet(
  db: DB,
  companyId: string,
  args: {
    id?: string;
    _id?: string;
    type: number;
    nguoiduyet: string;
    ngayduyet: string;
  },
): Promise<Array<{ updated: number }>> {
  if (!args.id && !args._id) throw new Error("Thiếu id");
  if (args.type == null) throw new Error("Thiếu type");
  if (!args.nguoiduyet) throw new Error("Thiếu nguoiduyet");
  if (!args.ngayduyet) throw new Error("Thiếu ngayduyet");

  const ngayduyet = new Date(args.ngayduyet).toISOString();

  const t = await procTable(db, companyId, "tr_denghi_thanhtoan");
  // _id = uuid VẬT LÝ dòng (rowAction inject) → match cột id; id = GUID
  // nghiệp vụ (caller cũ) → match field "id" (text).
  const where = args._id ? sql`id = ${args._id}::uuid` : sql`${t.text("id")} = ${args.id}`;

  if (args.type === 0) {
    // Trưởng bộ phận duyệt
    const updated = await t.updateWhere(
      { truongbophan: args.nguoiduyet, ngayduyet2: ngayduyet },
      where,
    );
    return [{ updated }];
  }

  if (args.type === 1) {
    // Ban giám đốc duyệt
    const updated = await t.updateWhere(
      { nguoiduyet: args.nguoiduyet, ngayduyet: ngayduyet },
      where,
    );
    return [{ updated }];
  }

  // T-SQL gốc không có nhánh nào khác — giữ no-op
  return [{ updated: 0 }];
}
