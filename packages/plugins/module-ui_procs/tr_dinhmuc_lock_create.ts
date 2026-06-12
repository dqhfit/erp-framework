/* Port TR_DINHMUC_LOCK_CREATE — tạo/cập nhật trạng thái khoá định mức
   cho sản phẩm theo loại định mức:
   1. Sản phẩm phải CÓ định mức ở bảng tương ứng loại (đếm > 0):
      GVA → tr_dinhmuc_govan, NKI → tr_dinhmuc_ngukim,
      DGO → tr_dinhmuc_donggoi, SON → tr_dinhmuc_son.
   2. Có định mức → upsert tr_dinhmuc_lock theo (masp, loaidinhmuc):
      tồn tại → update islock/ngaysua/nguoisua; chưa → insert dòng mới.
   Nguồn: migration-plan/ui/proc-bodies/tr_dinhmuc_lock_create.sql

   LƯU Ý port theo INTENT: T-SQL gốc dùng GOTO không có nhảy thoát sau
   mỗi label nên fall-through chạy hết 4 SELECT COUNT — @COUNTER thực tế
   luôn là count của tr_dinhmuc_son (bug nguồn). Bản port đếm ĐÚNG bảng
   theo loaidinhmuc như chủ đích của proc. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable, rows } from "../src/proc-table";

const COUNT_TABLE: Record<string, string> = {
  GVA: "tr_dinhmuc_govan",
  NKI: "tr_dinhmuc_ngukim",
  DGO: "tr_dinhmuc_donggoi",
  SON: "tr_dinhmuc_son",
};

export async function trDinhmucLockCreate(
  db: DB,
  companyId: string,
  args: {
    masp: string;
    loaidinhmuc: string;
    islock: boolean;
    ngaysua?: string | null;
    nguoisua?: string | null;
  },
): Promise<Array<{ action: "updated" | "inserted" | "skipped"; id?: string }>> {
  if (!args.masp) throw new Error("Thiếu masp");
  if (!args.loaidinhmuc) throw new Error("Thiếu loaidinhmuc");

  const countEntity = COUNT_TABLE[args.loaidinhmuc];
  if (!countEntity) {
    throw new Error(`loaidinhmuc không hợp lệ: "${args.loaidinhmuc}" (chỉ nhận GVA/NKI/DGO/SON)`);
  }

  // Bước 1: sản phẩm phải có định mức ở bảng tương ứng
  const tDm = await procTable(db, companyId, countEntity);
  const res = await db.execute(
    sql`SELECT count(*)::int AS cnt FROM ${tDm.tbl} WHERE ${tDm.scope} AND ${tDm.text("masp")} = ${args.masp}`,
  );
  const counter = Number(rows<{ cnt: number }>(res)[0]?.cnt ?? 0);
  if (counter === 0) return [{ action: "skipped" }]; // proc gốc: không có định mức → không làm gì

  // Bước 2: upsert tr_dinhmuc_lock theo (masp, loaidinhmuc)
  const t = await procTable(db, companyId, "tr_dinhmuc_lock");
  const where = sql`${t.text("masp")} = ${args.masp} AND ${t.text("loaidinhmuc")} = ${args.loaidinhmuc}`;
  const [existing] = await t.listWhere(where, { limit: 1 });

  if (existing) {
    await t.updateWhere(
      {
        islock: args.islock,
        ngaysua: args.ngaysua ?? null,
        nguoisua: args.nguoisua ?? null,
      },
      where,
    );
    return [{ action: "updated", id: String(existing._id) }];
  }

  // Proc gốc insert id = newid() — hệ mới PK uuid của row tự sinh, không set field id.
  const id = await t.insertRow({
    masp: args.masp,
    loaidinhmuc: args.loaidinhmuc,
    islock: args.islock,
    ngaysua: args.ngaysua ?? null,
    nguoisua: args.nguoisua ?? null,
  });
  return [{ action: "inserted", id }];
}
