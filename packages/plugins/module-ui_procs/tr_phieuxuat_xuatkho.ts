/* Xuất kho 1 phiếu xuất (tr_phieuxuat): TRỪ tồn khỏi stockbalances theo từng
   dòng chi tiết (tr_ctphieuxuat) + ghi lịch sử giao dịch stocktransaction +
   đánh dấu phiếu đã xuất kho.

   Đối xứng với tr_phieunhap_ghikho (nhập = cộng); ở đây xuất = trừ.
   stocktransaction khớp DDL gốc dbo.StockTransaction: sourcetype="OUT" (xuất),
   quantity ÂM (-soluong), amount = quantity*unitprice (âm), createdby = người
   xuất kho, stocktransactionid = max+1 (company-scoped).

   Luồng: nút "Xuất kho" trên trang 58c3eea2 (list phiếu xuất, dòng đang chọn)
   gọi proc với _id = uuid phiếu xuất. Proc:
     1. Đọc phiếu theo _id → sopx, makho, daxuatkho.
        - daxuatkho = true → CHẶN xuất lặp.
     2. Đọc các dòng chi tiết WHERE phieuxuat = phiếu.sopx.
     3. Mỗi dòng: tìm stockbalances theo (warehousecode=makho, materialcode=mact,
        batchno) — có thì quantity -= soluong; chưa có thì tạo row quantity = -soluong
        (ghi nhận phần trừ/âm kho). Ghi 1 dòng stocktransaction (sourcetype="OUT",
        quantity âm).
     4. Cập nhật phiếu: daxuatkho=true, ngayxuatkho, nguoixuatkho.

   Toàn bộ trong 1 transaction (checkpoint atomic với data). Chi tiết là bảng
   mirror (chỉ đọc). stockbalances + stocktransaction = live (ghi được);
   tr_phieuxuat mirror → cần ERP_ALLOW_MIRROR_WRITE=1 (local) hoặc cutover (prod). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable, rows } from "../src/proc-table";

export async function trPhieuxuatXuatkho(
  db: DB,
  companyId: string,
  args: {
    _id?: string;
    nguoixuatkho: string;
    ngayxuatkho: string;
  },
): Promise<Array<{ posted: number; message: string }>> {
  if (!args._id) throw new Error("Thiếu _id phiếu xuất");
  if (!args.ngayxuatkho) throw new Error("Thiếu ngày xuất kho");

  return db.transaction(async (tx) => {
    const px = await procTable(tx, companyId, "tr_phieuxuat");

    // 1. Đọc phiếu.
    const found = await px.listWhere(sql`id = ${args._id}::uuid`, { limit: 1 });
    const phieu = found[0];
    if (!phieu) throw new Error("Không tìm thấy phiếu xuất");

    const sopx = phieu.sopx == null ? "" : String(phieu.sopx);
    const makho = phieu.makho == null ? "" : String(phieu.makho);
    if (!sopx) throw new Error("Phiếu xuất chưa có số phiếu (sopx) — không thể xuất kho");
    if (!makho) throw new Error("Phiếu xuất chưa có kho (makho) — không thể xuất kho");

    // Chặn xuất lặp.
    const already =
      phieu.daxuatkho === true || phieu.daxuatkho === "true" || phieu.daxuatkho === 1;
    if (already) {
      return [{ posted: 0, message: `Phiếu ${sopx} đã xuất kho trước đó — bỏ qua.` }];
    }

    // 2. Đọc chi tiết.
    const ct = await procTable(tx, companyId, "tr_ctphieuxuat");
    const lines = await ct.listWhere(sql`${ct.text("phieuxuat")} = ${sopx}`);

    // 3. Trừ tồn + ghi giao dịch.
    const sb = await procTable(tx, companyId, "stockbalances");
    const st = await procTable(tx, companyId, "stocktransaction");

    const maxRows = rows<{ next: number }>(
      await tx.execute(
        sql`SELECT COALESCE(MAX(${st.num("stocktransactionid")}), 0) + 1 AS next
            FROM ${st.tbl} WHERE ${st.scope}`,
      ),
    );
    let nextStId = Number(maxRows[0]?.next ?? 1);
    let posted = 0;

    for (const line of lines) {
      const mavt = line.mact == null ? "" : String(line.mact);
      const qty = Number(line.soluong ?? 0);
      if (!mavt || !Number.isFinite(qty) || qty === 0) continue; // bỏ dòng rỗng

      const batchno = line.batchno == null ? "" : String(line.batchno);
      const unitprice = line.giaxuat == null ? null : Number(line.giaxuat);
      const lineGhichu = line.ghichu == null ? "" : String(line.ghichu);

      // Tìm row tồn theo khoá (kho + vật tư + lô) — batchno null/'' coi như nhau.
      const existing = await sb.listWhere(
        sql`${sb.text("warehousecode")} = ${makho}
            AND ${sb.text("materialcode")} = ${mavt}
            AND COALESCE(${sb.text("batchno")}, '') = ${batchno}`,
        { limit: 1 },
      );

      const cur = existing[0];
      if (cur) {
        const oldQty = Number(cur.quantity ?? 0);
        await sb.updateWhere(
          { quantity: (Number.isFinite(oldQty) ? oldQty : 0) - qty },
          sql`id = ${cur._id}::uuid`,
        );
      } else {
        // Chưa có tồn → tạo row âm (ghi nhận phần đã xuất vượt/thiếu tồn).
        await sb.insertRow({
          warehousecode: makho,
          materialcode: mavt,
          batchno: batchno || null,
          quantity: -qty,
        });
      }

      // Lịch sử giao dịch. Xuất kho: sourcetype="OUT", quantity ÂM,
      // amount = quantity*unitprice (âm). Phiếu xuất không có id legacy numeric →
      // sourceid null, gắn sopx vào note để truy vết.
      const note = lineGhichu ? `Xuất kho phiếu ${sopx} — ${lineGhichu}` : `Xuất kho phiếu ${sopx}`;
      await st.insertRow({
        stocktransactionid: nextStId,
        transactiondate: args.ngayxuatkho,
        sourcetype: "OUT",
        sourceid: null,
        warehousecode: makho,
        materialcode: mavt,
        batchno: batchno || null,
        quantity: -qty,
        unitprice,
        amount: unitprice == null ? null : -qty * unitprice,
        suppliercode: null,
        createdby: args.nguoixuatkho || null,
        note,
        currency: null,
      });
      nextStId++;
      posted++;
    }

    // 4. Đánh dấu phiếu đã xuất kho.
    await px.updateWhere(
      { daxuatkho: true, ngayxuatkho: args.ngayxuatkho, nguoixuatkho: args.nguoixuatkho || null },
      sql`id = ${args._id}::uuid`,
    );

    const msg =
      posted > 0
        ? `Đã xuất kho phiếu ${sopx}: trừ tồn ${posted} dòng vật tư.`
        : `Phiếu ${sopx} không có dòng chi tiết hợp lệ — chỉ đánh dấu đã xuất kho.`;
    return [{ posted, message: msg }];
  });
}
