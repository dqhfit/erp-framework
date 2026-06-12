/* Port TR_NGUOIDUYET_BOPHAN_CREATE — thêm người duyệt bộ phận, chống trùng
   (username + mabophan + phanloai). RAISERROR gốc → throw Error.
   @id uniqueidentifier nguồn là FIELD "id" (không phải uuid row).
   Nguồn: proc-bodies/tr_nguoiduyet_bophan_create.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trNguoiduyetBophanCreate(
  db: DB,
  companyId: string,
  args: {
    id: string;
    username: string;
    mabophan: string;
    phanloai: string;
  },
): Promise<Array<{ id: string }>> {
  if (!args.username) throw new Error("Thiếu username");
  if (!args.mabophan) throw new Error("Thiếu mabophan");
  if (!args.phanloai) throw new Error("Thiếu phanloai");

  const t = await procTable(db, companyId, "tr_nguoiduyet_bophan");
  const existing = await t.listWhere(
    sql`${t.text("username")} = ${args.username}
        AND ${t.text("mabophan")} = ${args.mabophan}
        AND ${t.text("phanloai")} = ${args.phanloai}`,
    { limit: 1 },
  );
  if (existing.length > 0) {
    throw new Error("Người dùng này đã tồn tại");
  }

  const rowId = await t.insertRow({
    id: args.id,
    username: args.username,
    mabophan: args.mabophan,
    phanloai: args.phanloai,
  });
  return [{ id: rowId }];
}
