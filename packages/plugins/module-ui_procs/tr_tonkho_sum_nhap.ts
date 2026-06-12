/* Port TR_TONKHO_SUM_NHAP — cộng dồn tồn kho khi nhập:
   1. Vật tư phải tồn tại + chưa xoá (COALESCE(xoa,'N')='N').
   2. Suy mã kho: tr_material.kho (tên) → tr_site.name theo description;
      không khớp → 'OTHER'.
   3. Upsert tr_tonkho_sum theo (mavt, makho): có → soluong += nhập;
      chưa → insert soluong_toithieu=0.
   Nguồn: proc-bodies/tr_tonkho_sum_nhap.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trTonkhoSumNhap(
  db: DB,
  companyId: string,
  args: { mact: string; soluong_nhap: number },
): Promise<Array<{ action: "updated" | "inserted" | "skipped"; makho?: string }>> {
  if (!args.mact) throw new Error("Thiếu mact");
  if (args.soluong_nhap == null) throw new Error("Thiếu soluong_nhap");

  const tVt = await procTable(db, companyId, "tr_material");
  const [vt] = await tVt.listWhere(
    sql`${tVt.text("mavt")} = ${args.mact} AND COALESCE(${tVt.text("xoa")}, 'N') = 'N'`,
    { limit: 1 },
  );
  if (!vt) return [{ action: "skipped" }]; // proc gốc: không tồn tại → không làm gì

  // Suy mã kho từ tên kho của vật tư
  let makho = "OTHER";
  const tenkho = vt.kho == null ? "" : String(vt.kho);
  if (tenkho) {
    const tSite = await procTable(db, companyId, "tr_site");
    const [site] = await tSite.listWhere(sql`${tSite.text("description")} = ${tenkho}`, {
      limit: 1,
    });
    if (site?.name != null && String(site.name) !== "") makho = String(site.name);
  }

  const t = await procTable(db, companyId, "tr_tonkho_sum");
  const [ton] = await t.listWhere(
    sql`${t.text("mavt")} = ${args.mact} AND ${t.text("makho")} = ${makho}`,
    { limit: 1 },
  );

  if (ton) {
    const current = Number(ton.soluong) || 0;
    await t.updateWhere(
      { soluong: current + args.soluong_nhap },
      sql`${t.text("mavt")} = ${args.mact} AND ${t.text("makho")} = ${makho}`,
    );
    return [{ action: "updated", makho }];
  }

  await t.insertRow({
    mavt: args.mact,
    makho,
    soluong: args.soluong_nhap,
    soluong_toithieu: 0,
  });
  return [{ action: "inserted", makho }];
}
