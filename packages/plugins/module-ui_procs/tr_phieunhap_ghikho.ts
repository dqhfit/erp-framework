/* Ghi kho 1 phiếu nhập (tr_phieunhap): cộng tồn vào stockbalances theo từng
   dòng chi tiết (tr_ctphieunhap) + ghi lịch sử giao dịch stocktransaction +
   đánh dấu phiếu đã ghi kho.

   stocktransaction khớp DDL gốc dbo.StockTransaction (data-import/stockBalances.sql):
   sourcetype="IN" (nhập), quantity (+) nhập / (-) xuất, amount = quantity*unitprice,
   suppliercode = mã NCC của phiếu, createdby = người ghi kho, stocktransactionid =
   max+1 (id legacy bigint identity, ta tự sinh vì bảng do ta sở hữu).

   Luồng: nút "Ghi kho" trên trang 58c3eea2 (toolbar, dòng đang chọn) gọi proc
   này với _id = uuid phiếu nhập. Proc:
     1. Đọc phiếu theo _id → sopn, makho, mancc, daghikho.
        - daghikho = true → CHẶN ghi lặp (trả message, không xử lý lại).
     2. Đọc các dòng chi tiết WHERE sopn = phiếu.sopn.
     3. Mỗi dòng: upsert stockbalances theo khoá (warehousecode=makho,
        materialcode=mavt, batchno) — có thì quantity += slnhap, chưa có thì
        tạo row mới (carry fscid/nhomnguyenlieu/malonguyenlieu2/expdate).
        Ghi 1 dòng stocktransaction (sourcetype="IN", quantity dương).
     4. Cập nhật phiếu: daghikho=true, ngayghikho, nguoighikho.

   Toàn bộ trong 1 transaction → crash giữa chừng không để tồn lệch/cờ sai
   (bài học #13b: checkpoint atomic với data). Đọc chi tiết là bảng mirror
   (chỉ đọc, không ghi). stockbalances + stocktransaction = live (ghi được);
   tr_phieunhap mirror → cần ERP_ALLOW_MIRROR_WRITE=1 (local) hoặc cutover (prod). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable, rows } from "../src/proc-table";

export async function trPhieunhapGhikho(
  db: DB,
  companyId: string,
  args: {
    _id?: string;
    nguoighikho: string;
    ngayghikho: string;
  },
): Promise<Array<{ posted: number; message: string }>> {
  if (!args._id) throw new Error("Thiếu _id phiếu nhập");
  if (!args.ngayghikho) throw new Error("Thiếu ngày ghi kho");

  return db.transaction(async (tx) => {
    const pn = await procTable(tx, companyId, "tr_phieunhap");

    // 1. Đọc phiếu.
    const found = await pn.listWhere(sql`id = ${args._id}::uuid`, { limit: 1 });
    const phieu = found[0];
    if (!phieu) throw new Error("Không tìm thấy phiếu nhập");

    const sopn = phieu.sopn == null ? "" : String(phieu.sopn);
    const makho = phieu.makho == null ? "" : String(phieu.makho);
    const mancc = phieu.mancc == null ? null : String(phieu.mancc);
    if (!sopn) throw new Error("Phiếu nhập chưa có số phiếu (sopn) — không thể ghi kho");
    if (!makho) throw new Error("Phiếu nhập chưa có kho (makho) — không thể ghi kho");

    // Chặn ghi lặp.
    const already = phieu.daghikho === true || phieu.daghikho === "true" || phieu.daghikho === 1;
    if (already) {
      return [{ posted: 0, message: `Phiếu ${sopn} đã ghi kho trước đó — bỏ qua.` }];
    }

    // 2. Đọc chi tiết.
    const ct = await procTable(tx, companyId, "tr_ctphieunhap");
    const lines = await ct.listWhere(sql`${ct.text("sopn")} = ${sopn}`);

    // 3. Upsert tồn + ghi giao dịch.
    const sb = await procTable(tx, companyId, "stockbalances");
    const st = await procTable(tx, companyId, "stocktransaction");

    // ID giao dịch legacy (bigint identity bên MSSQL) — ta tự sinh max+1 (company-scoped).
    const maxRows = rows<{ next: number }>(
      await tx.execute(
        sql`SELECT COALESCE(MAX(${st.num("stocktransactionid")}), 0) + 1 AS next
            FROM ${st.tbl} WHERE ${st.scope}`,
      ),
    );
    let nextStId = Number(maxRows[0]?.next ?? 1);
    let posted = 0;

    for (const line of lines) {
      const mavt = line.mavt == null ? "" : String(line.mavt);
      const qty = Number(line.slnhap ?? 0);
      if (!mavt || !Number.isFinite(qty) || qty === 0) continue; // bỏ dòng rỗng

      const batchno = line.batchno == null ? "" : String(line.batchno);
      const unitprice = line.gianhap == null ? null : Number(line.gianhap);
      const currency = line.loaitien == null ? null : String(line.loaitien);
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
          { quantity: (Number.isFinite(oldQty) ? oldQty : 0) + qty },
          sql`id = ${cur._id}::uuid`,
        );
      } else {
        await sb.insertRow({
          warehousecode: makho,
          materialcode: mavt,
          batchno: batchno || null,
          quantity: qty,
          fscid: line.fscid ?? null,
          nhomnguyenlieu: line.nhomnguyenlieu ?? null,
          malonguyenlieu2: line.malonguyenlieu2 ?? null,
          expdate: line.hansudung ?? null,
        });
      }

      // Lịch sử giao dịch (khớp dbo.StockTransaction). Nhập kho: sourcetype="IN",
      // quantity dương, amount = quantity*unitprice. Phiếu nhập không có id legacy
      // numeric → sourceid null, gắn sopn vào note để truy vết.
      const note = lineGhichu ? `Ghi kho phiếu ${sopn} — ${lineGhichu}` : `Ghi kho phiếu ${sopn}`;
      await st.insertRow({
        stocktransactionid: nextStId,
        transactiondate: args.ngayghikho,
        sourcetype: "IN",
        sourceid: null,
        warehousecode: makho,
        materialcode: mavt,
        batchno: batchno || null,
        quantity: qty,
        unitprice,
        amount: unitprice == null ? null : qty * unitprice,
        suppliercode: mancc,
        createdby: args.nguoighikho || null,
        note,
        currency,
        fscid: line.fscid ?? null,
        nhomnguyenlieu: line.nhomnguyenlieu ?? null,
        malonguyenlieu2: line.malonguyenlieu2 ?? null,
        expdate: line.hansudung ?? null,
      });
      nextStId++;
      posted++;
    }

    // 4. Đánh dấu phiếu đã ghi kho.
    await pn.updateWhere(
      { daghikho: true, ngayghikho: args.ngayghikho, nguoighikho: args.nguoighikho || null },
      sql`id = ${args._id}::uuid`,
    );

    const msg =
      posted > 0
        ? `Đã ghi kho phiếu ${sopn}: cập nhật tồn ${posted} dòng vật tư.`
        : `Phiếu ${sopn} không có dòng chi tiết hợp lệ — chỉ đánh dấu đã ghi kho.`;
    return [{ posted, message: msg }];
  });
}
