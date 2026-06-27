/* Duyệt 1 dòng báo giá vật tư (tr_phieubaogia_chitiet) + cập nhật ngược đơn giá
   mới và nhà cung cấp vào danh mục vật tư (tr_material).

   Luồng: rowAction "Duyệt" trên trang 6e81933c gọi proc này (tự inject _id = uuid
   dòng). Proc:
     1. Đọc dòng chi tiết theo _id → mact, dongiamoi, loaitien, mancc.
     2. Duyệt dòng: nguoiduyet = người đăng nhập, ngayduyet = giờ hiện tại,
        isnotduyet = false (gỡ cờ "không duyệt" nếu duyệt lại).
     3. Tra tên NCC (tenncc) từ tr_nhacc theo vendor_id = mancc (dòng chi tiết
        chỉ lưu mã NCC, không lưu tên).
     4. Gọi updateMaterialPrice → set tr_material.dongia/mancc/tenncc/loaitien
        WHERE COALESCE(idxuong, mavt) = mact.

   Fail-safe: cập nhật vật tư lỗi/không khớp mã KHÔNG làm hỏng việc duyệt — duyệt
   là chính, propagate giá là phụ. Trả message cho toast. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable, rows } from "../src/proc-table";
import { updateMaterialPrice } from "./updatematerialprice";

export async function trPhieubaogiaChitietDuyet(
  db: DB,
  companyId: string,
  args: {
    _id?: string;
    nguoiduyet: string;
    ngayduyet: string;
  },
): Promise<Array<{ approved: number; material_rows_updated: number; message: string }>> {
  if (!args._id) throw new Error("Thiếu _id dòng báo giá");
  if (!args.nguoiduyet) throw new Error("Thiếu người duyệt");

  const ct = await procTable(db, companyId, "tr_phieubaogia_chitiet");

  // 1. Đọc dòng chi tiết theo uuid vật lý.
  const found = await ct.listWhere(sql`id = ${args._id}::uuid`, { limit: 1 });
  const row = found[0];
  if (!row) throw new Error("Không tìm thấy dòng báo giá");

  // 2. Duyệt dòng.
  const approved = await ct.updateWhere(
    { nguoiduyet: args.nguoiduyet, ngayduyet: args.ngayduyet, isnotduyet: false },
    sql`id = ${args._id}::uuid`,
  );

  // 3 + 4. Cập nhật ngược đơn giá + NCC vào tr_material + ghi giá theo NCC.
  let materialRows = 0;
  let nccInserted = false;
  const mact = row.mact == null ? "" : String(row.mact);
  const price = row.dongiamoi == null ? null : Number(row.dongiamoi);
  const vendorCode = row.mancc == null ? "" : String(row.mancc);
  const loaiTien = row.loaitien == null ? null : String(row.loaitien);

  if (mact && price != null && Number.isFinite(price)) {
    // 3a. Tên NCC từ tr_nhacc (vendor_id = mã NCC trên dòng) — dùng chung.
    let vendorName = "";
    if (vendorCode) {
      try {
        const ncc = await procTable(db, companyId, "tr_nhacc");
        const nccRows = await ncc.listWhere(sql`${ncc.text("vendor_id")} = ${vendorCode}`, {
          limit: 1,
        });
        vendorName = nccRows[0]?.vendor_name == null ? "" : String(nccRows[0].vendor_name);
      } catch (e) {
        console.warn(`[tr_phieubaogia_chitiet_duyet] tra tr_nhacc lỗi:`, (e as Error).message);
      }
    }

    // 4. Cập nhật master tr_material (fail-safe).
    try {
      const res = await updateMaterialPrice(db, companyId, {
        material_code: mact,
        price,
        loai_tien: loaiTien,
        vendor_code: vendorCode,
        vendor_name: vendorName,
      });
      materialRows = res[0]?.rows_updated ?? 0;
    } catch (e) {
      console.warn(`[tr_phieubaogia_chitiet_duyet] cập nhật tr_material lỗi:`, (e as Error).message);
    }

    // 5. Ghi giá theo NCC vào tr_material_ncc + ĐẶT MẶC ĐỊNH (fail-safe).
    //    Gỡ macdinh các dòng cũ cùng ma_nvl → chỉ dòng mới là mặc định.
    try {
      const mn = await procTable(db, companyId, "tr_material_ncc");
      await mn.updateWhere({ macdinh: false }, sql`${mn.text("ma_nvl")} = ${mact}`);
      // id legacy (numeric) = max + 1 — giữ liên tục với dữ liệu cũ.
      const maxRows = rows<{ next: number }>(
        await db.execute(
          sql`SELECT COALESCE(MAX(${mn.num("id")}), 0) + 1 AS next FROM ${mn.tbl} WHERE ${mn.scope}`,
        ),
      );
      const nextId = Number(maxRows[0]?.next ?? 1);
      await mn.insertRow({
        id: nextId,
        ma_nvl: mact,
        ma_ncc: vendorCode,
        dongia: price,
        tungay: args.ngayduyet,
        denngay: args.ngayduyet,
        macdinh: true,
        tigia: loaiTien,
      });
      nccInserted = true;
    } catch (e) {
      console.warn(`[tr_phieubaogia_chitiet_duyet] ghi tr_material_ncc lỗi:`, (e as Error).message);
    }
  }

  const parts = [`Đã duyệt.`];
  if (materialRows > 0) parts.push(`Cập nhật giá vật tư ${mact}.`);
  else if (mact) parts.push(`(Không thấy vật tư ${mact} trong danh mục.)`);
  if (nccInserted) parts.push(`Đã thêm giá NCC (${vendorCode}) làm mặc định.`);

  return [{ approved, material_rows_updated: materialRows, message: parts.join(" ") }];
}
