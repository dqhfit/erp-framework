/* Port TR_TONKHO_SUM_CHUYENKHO — chuyển kho cho 1 vật tư:
   1. Map mã kho mới sang tên kho (KTV→TẠP VỤ, HTR→HÀNG TRẮNG, ...;
      mã lạ → VẬT TƯ KHÁC).
   2. Suy mã kho cũ từ tên kho hiện tại của tr_material.kho (map ngược;
      tên lạ → OTHER). Vật tư không tồn tại → @khocu NULL → so sánh
      UNKNOWN → proc gốc không làm gì (skipped).
   3. Nếu mã mới khác mã cũ: gom TỔNG soluong hiện có của vật tư trong
      tr_tonkho_sum (tính TRƯỚC khi xoá — tương đương temp #SOLUONG_TONKHO),
      xoá hết dòng tr_tonkho_sum + tr_tonkho_chitiet của vật tư, insert lại
      1 dòng tr_tonkho_sum ở kho mới với tổng đó (chỉ khi trước đó có dòng),
      rồi đổi tr_material.kho = tên kho mới.
   Proc gốc bọc TRANSACTION + TRY/CATCH rollback; helper procTable không có
   transaction xuyên statement — chạy tuần tự, mỗi bước scope theo mavt.
   Nguồn: migration-plan/ui/proc-bodies/tr_tonkho_sum_chuyenkho.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable, rows } from "../src/proc-table";

const KHO_BY_CODE: Record<string, string> = {
  KTV: "TẠP VỤ",
  HTR: "HÀNG TRẮNG",
  VPH: "VĂN PHÒNG PHẨM",
  SON: "HÓA CHẤT",
  GVA: "GỖ VÁN",
  NKI: "NGŨ KIM",
  DGO: "BAO BÌ",
  BT: "BẢO TRÌ",
};
const CODE_BY_KHO: Record<string, string> = Object.fromEntries(
  Object.entries(KHO_BY_CODE).map(([code, name]) => [name, code]),
);

export async function trTonkhoSumChuyenkho(
  db: DB,
  companyId: string,
  args: { mact: string; khomoi: string },
): Promise<
  Array<{ action: "moved" | "skipped"; khocu?: string; khomoi?: string; soluong?: number }>
> {
  if (!args.mact) throw new Error("Thiếu mact");
  if (!args.khomoi) throw new Error("Thiếu khomoi");

  const tenkhomoi = KHO_BY_CODE[args.khomoi] ?? "VẬT TƯ KHÁC";

  const tVt = await procTable(db, companyId, "tr_material");
  const [vt] = await tVt.listWhere(sql`${tVt.text("mavt")} = ${args.mact}`, { limit: 1 });
  // Proc gốc: vật tư không tồn tại → @khocu = NULL → IF @khomoi != @khocu
  // là UNKNOWN → không thực hiện gì.
  if (!vt) return [{ action: "skipped" }];

  const tenkhoCu = vt.kho == null ? "" : String(vt.kho);
  const khocu = CODE_BY_KHO[tenkhoCu] ?? "OTHER";
  if (args.khomoi === khocu) return [{ action: "skipped", khocu }];

  // Tổng tồn hiện tại của vật tư — tính TRƯỚC khi xoá (temp table ở proc gốc)
  const tSum = await procTable(db, companyId, "tr_tonkho_sum");
  const aggRes = await db.execute(sql`
    SELECT SUM(${tSum.num("soluong")}) AS soluong, COUNT(*) AS n
    FROM ${tSum.tbl}
    WHERE ${tSum.scope} AND ${tSum.text("mavt")} = ${args.mact}
  `);
  const [agg] = rows<{ soluong: unknown; n: unknown }>(aggRes);
  const hadRows = Number(agg?.n ?? 0) > 0;
  const tongSoluong = Number(agg?.soluong ?? 0);

  // Xoá tồn kho cũ (proc gốc DELETE thật — hệ mới chuẩn soft-delete)
  await tSum.softDeleteWhere(sql`${tSum.text("mavt")} = ${args.mact}`);
  const tCt = await procTable(db, companyId, "tr_tonkho_chitiet");
  await tCt.softDeleteWhere(sql`${tCt.text("mavt")} = ${args.mact}`);

  // Insert lại tổng tồn ở kho mới — chỉ khi trước đó có dòng tồn
  // (INSERT...SELECT từ temp rỗng = không insert gì)
  if (hadRows) {
    await tSum.insertRow({
      mavt: args.mact,
      makho: args.khomoi,
      soluong: tongSoluong,
      soluong_toithieu: 0,
    });
  }

  // Đổi tên kho trên vật tư
  await tVt.updateWhere({ kho: tenkhomoi }, sql`${tVt.text("mavt")} = ${args.mact}`);

  return [{ action: "moved", khocu, khomoi: args.khomoi, soluong: tongSoluong }];
}
