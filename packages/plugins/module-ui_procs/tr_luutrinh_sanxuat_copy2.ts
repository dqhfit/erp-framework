/* Port TR_LUUTRINH_SANXUAT_COPY2 — copy lưu trình sản xuất từ
   (masp1, mact1) sang (masp2, mact2): xoá lưu trình đích cũ rồi insert
   bản sao từng dòng nguồn với masp/mact mới.
   Nguồn: migration-plan/ui/proc-bodies/tr_luutrinh_sanxuat_copy2.sql
   DELETE gốc → soft-delete (chuẩn hệ mới). Proc gốc copy đúng các cột:
   stt, xuong, tonhom, may, thongtin, luuy, lanuv, somat, socanh, sodau,
   id_rout, active — KHÔNG copy routid (identity nguồn) và solop. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trLuutrinhSanxuatCopy2(
  db: DB,
  companyId: string,
  args: {
    masp1: string;
    mact1: string;
    masp2: string;
    mact2: string;
  },
): Promise<Array<{ deleted: number; copied: number }>> {
  if (!args.masp1) throw new Error("Thiếu masp1");
  if (!args.masp2) throw new Error("Thiếu masp2");

  const t = await procTable(db, companyId, "tr_luutrinh_sanxuat");

  // Bước 1: xoá lưu trình hiện có của đích (masp2, mact2)
  const deleted = await t.softDeleteWhere(
    sql`${t.text("masp")} = ${args.masp2} AND ${t.text("mact")} = ${args.mact2}`,
  );

  // Bước 2: đọc lưu trình nguồn (masp1, mact1) rồi insert bản sao cho đích
  const srcRows = await t.listWhere(
    sql`${t.text("masp")} = ${args.masp1} AND ${t.text("mact")} = ${args.mact1}`,
    { orderBy: sql`${t.num("stt")} ASC NULLS LAST` },
  );

  let copied = 0;
  for (const row of srcRows) {
    await t.insertRow({
      stt: row.stt ?? null,
      xuong: row.xuong ?? null,
      tonhom: row.tonhom ?? null,
      may: row.may ?? null,
      thongtin: row.thongtin ?? null,
      luuy: row.luuy ?? null,
      lanuv: row.lanuv ?? null,
      somat: row.somat ?? null,
      socanh: row.socanh ?? null,
      sodau: row.sodau ?? null,
      masp: args.masp2,
      mact: args.mact2,
      id_rout: row.id_rout ?? null,
      active: row.active ?? null,
    });
    copied++;
  }

  return [{ deleted, copied }];
}
