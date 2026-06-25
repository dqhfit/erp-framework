/* Port MES_QUYTRINH_SANPHAM_PHATHANH — "Phát hành" quy trình sản phẩm
   (nút btnPhatHanh form frmPhatHanhDinhMuc2). Body trích từ MSSQL MES:
   migration-plan/ui/proc-bodies/mes_quytrinh_sanpham_phathanh.sql

   Logic gốc (cursor theo masp_nhamay):
     - Mỗi tr_sanpham.masp có masp_nhamay = @masp_nhamay AND active=1:
       1) DELETE tr_quytrinh_sanpham2 WHERE masp = @masp (xoá quy trình cũ)
       2) INSERT tr_quytrinh_sanpham2 (NEWID() id, masp=@masp, copy các cột)
          SELECT FROM mes_quytrinh_sanpham WHERE masp = @masp_nhamay AND active=1
          (template quy trình theo mã nhà máy → áp cho từng sản phẩm)
       3) UPDATE tr_sanpham SET IsQuyTrinh = (COUNT quytrinh NOT NULL > 0)

   HYBRID/ERP:
   - tr_quytrinh_sanpham2 sync=null → GHI được (delete hard như proc gốc + insert).
   - mes_quytrinh_sanpham mirror → chỉ ĐỌC (template), OK.
   - tr_sanpham mirror → KHÔNG ghi được cờ isquytrinh; bọc mirror-safe (bỏ qua
     bước cờ khi entity còn mirror — sync/cutover sẽ set sau). Việc cốt lõi
     (copy quy trình) vẫn chạy.
   Bọc transaction: lỗi giữa chừng → rollback, không để quy trình mồ côi. */
import { randomUUID } from "node:crypto";
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

// Cột copy nguyên văn template → quy trình sản phẩm (theo INSERT proc gốc;
// id sinh mới, masp gán = sản phẩm đích).
const COPY_FIELDS = [
  "mact",
  "stt",
  "tenct",
  "nguyenlieu",
  "dayy_tc",
  "rong_tc",
  "dai_tc",
  "quytrinh",
  "quytrinh2",
  "id_maymoc",
  "maymoc",
  "buoc",
  "attribute1",
  "attribute2",
  "attribute3",
  "attribute4",
  "attribute5",
  "attribute6",
  "attribute7",
  "attribute8",
  "attribute9",
  "active",
  "ngaytao",
  "nguoitao",
  "ngaysua",
  "nguoisua",
  "nguoichiutrachnhiem",
  "nguoikiemtra",
] as const;

export async function mesQuytrinhSanphamPhathanh(
  db: DB,
  companyId: string,
  args: { masp_nhamay: string },
): Promise<Array<{ products: number; inserted: number; flagSkipped: boolean; message: string }>> {
  if (!args.masp_nhamay) throw new Error("Thiếu masp_nhamay");

  return db.transaction(async (tx) => {
    const sp = await procTable(tx, companyId, "tr_sanpham");
    const qt = await procTable(tx, companyId, "tr_quytrinh_sanpham2");
    const tpl = await procTable(tx, companyId, "mes_quytrinh_sanpham");

    // Các sản phẩm dùng chung mã nhà máy (cursor gốc).
    const products = await sp.listWhere(
      sql`${sp.text("masp_nhamay")} = ${args.masp_nhamay} AND ${sp.bool("active")} = true`,
    );
    if (products.length === 0) {
      return [
        {
          products: 0,
          inserted: 0,
          flagSkipped: false,
          message: "Không có sản phẩm active khớp mã nhà máy",
        },
      ];
    }

    // Template quy trình theo mã nhà máy (đọc 1 lần, dùng cho mọi masp).
    const tplRows = await tpl.listWhere(
      sql`${tpl.text("masp")} = ${args.masp_nhamay} AND ${tpl.bool("active")} = true`,
    );

    let inserted = 0;
    let flagSkipped = false;
    for (const p of products) {
      const masp = p.masp as string;
      if (!masp) continue;

      // 1) Xoá quy trình cũ (proc gốc DELETE thật — tr_quytrinh_sanpham2 ghi được).
      await qt.hardDeleteWhere(sql`${qt.text("masp")} = ${masp}`);

      // 2) Copy template → quy trình của sản phẩm (id sinh mới như NEWID()).
      for (const t of tplRows) {
        const data: Record<string, unknown> = { id: randomUUID(), masp };
        for (const f of COPY_FIELDS) data[f] = t[f];
        await qt.insertRow(data, null);
        inserted++;
      }

      // 3) Cập nhật cờ IsQuyTrinh (mirror-safe: tr_sanpham còn mirror → bỏ qua).
      const hasQt =
        (
          await qt.listWhere(
            sql`${qt.text("masp")} = ${masp} AND ${qt.raw("quytrinh")} IS NOT NULL`,
          )
        ).length > 0;
      try {
        await sp.updateWhere({ isquytrinh: hasQt }, sql`${sp.text("masp")} = ${masp}`);
      } catch (e) {
        if (/mirror/i.test((e as Error).message)) flagSkipped = true;
        else throw e;
      }
    }

    const note = flagSkipped
      ? " (cờ IsQuyTrinh bỏ qua — tr_sanpham còn mirror, set sau cutover)"
      : "";
    return [
      {
        products: products.length,
        inserted,
        flagSkipped,
        message: `Đã phát hành quy trình cho ${products.length} sản phẩm (${inserted} bước)${note}`,
      },
    ];
  });
}
