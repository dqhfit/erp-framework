/* Port TR_DINHMUC_LOCK_UNLOCK — mở khoá định mức khi KHÔNG còn lệnh cấp
   phát chưa phát (capphat = 0) tham chiếu sản phẩm:
   1. Duyệt mọi dòng tr_dinhmuc_lock đang islock = true.
   2. Đếm tr_lenhcapphat active chưa cấp phát theo loại định mức:
      - NKI: LoaiDonHang = 'NKI', LoaiCapPhat thuộc nhóm cấp phát ngũ kim,
        khớp master_code nếu có (rỗng thì dùng masp).
      - DGO: LoaiDonHang = 'DGO', khớp masp.
      - SON: LoaiDonHang = 'SON', LoaiCapPhat SONTRONG/SONNGOAI, khớp masp.
      - Loại khác (vd GVA): proc gốc không đếm, @CNT giữ 0 → luôn mở khoá.
   3. Đếm = 0 → set islock = false cho dòng đó.
   Nguồn: migration-plan/ui/proc-bodies/tr_dinhmuc_lock_unlock.sql */
import type { DB } from "@erp-framework/server/db";
import { sql, type SQL } from "drizzle-orm";
import { procTable, rows } from "../src/proc-table";

export async function trDinhmucLockUnlock(
  db: DB,
  companyId: string,
): Promise<Array<{ masp: string; loaidinhmuc: string }>> {
  const tLock = await procTable(db, companyId, "tr_dinhmuc_lock");
  const tLcp = await procTable(db, companyId, "tr_lenhcapphat");

  const locked = await tLock.listWhere(sql`${tLock.bool("islock")} = true`);
  const unlocked: Array<{ masp: string; loaidinhmuc: string }> = [];

  for (const row of locked) {
    const loaidinhmuc = row.loaidinhmuc == null ? "" : String(row.loaidinhmuc);
    const masp = row.masp == null ? "" : String(row.masp);

    let cond: SQL | null = null;
    if (loaidinhmuc === "NKI") {
      // T-SQL: CASE WHEN LEN(master_code) > 0 THEN master_code ELSE masp END = @masp
      cond = sql`${tLcp.bool("active")} = true
        AND ${tLcp.text("loaidonhang")} = 'NKI'
        AND ${tLcp.text("loaicapphat")} IN (${"BEFORE"}, ${"AFTER"}, ${"AI"}, ${"TRUOCSON"}, ${"SAUSON"})
        AND ${tLcp.bool("capphat")} = false
        AND CASE WHEN length(coalesce(${tLcp.text("master_code")}, '')) > 0
              THEN ${tLcp.text("master_code")} ELSE ${tLcp.text("masp")} END = ${masp}`;
    } else if (loaidinhmuc === "DGO") {
      cond = sql`${tLcp.bool("active")} = true
        AND ${tLcp.text("loaidonhang")} = 'DGO'
        AND ${tLcp.bool("capphat")} = false
        AND ${tLcp.text("masp")} = ${masp}`;
    } else if (loaidinhmuc === "SON") {
      cond = sql`${tLcp.bool("active")} = true
        AND ${tLcp.text("loaidonhang")} = 'SON'
        AND ${tLcp.text("loaicapphat")} IN (${"SONTRONG"}, ${"SONNGOAI"})
        AND ${tLcp.bool("capphat")} = false
        AND ${tLcp.text("masp")} = ${masp}`;
    }

    let cnt = 0;
    if (cond) {
      const res = await db.execute(
        sql`SELECT count(*)::int AS cnt FROM ${tLcp.tbl} WHERE ${tLcp.scope} AND (${cond})`,
      );
      cnt = Number(rows<{ cnt: number }>(res)[0]?.cnt ?? 0);
    }

    if (cnt === 0) {
      await tLock.updateWhere(
        { islock: false },
        sql`${tLock.text("masp")} = ${masp} AND ${tLock.text("loaidinhmuc")} = ${loaidinhmuc}`,
      );
      unlocked.push({ masp, loaidinhmuc });
    }
  }

  return unlocked;
}
