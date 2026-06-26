/* Copy định mức theo sản phẩm — port frmBOMCopy / MES_DINHMUC_COPY nhưng
   GHI THẲNG bảng tr_dinhmuc_{govan,ngukim,donggoi} (bảng trang ERP đang đọc),
   KHÔNG ghi mes_* (chốt với user 2026-06-26): copy xong hiện ngay trên trang.

   Ngữ nghĩa gốc (frmBOMCopy): chọn loại + SP nguồn + SP đích → THAY THẾ định mức
   SP đích bằng bản copy từ SP nguồn (xoá đích trước, rồi copy). Khoá = `masp`
   (= tr_sanpham.masp, KHÔNG phải masp_nhamay — verify khớp 100%). Audit
   ngaytao/nguoitao/ngaysua/nguoisua set theo thời điểm + người dùng.

   ⚠ Entity tr_dinhmuc_* đang MIRROR → proc-table assertWritable chặn ghi tới khi
   CUTOVER module (sync.state='live'). Đúng fail-closed — nút sẽ báo "đang mirror"
   cho tới lúc đó.

   Copy bằng listWhere (đọc mọi field nguồn) → hardDelete đích → insertRow từng
   dòng (bỏ `_id` uuid vật lý + `id` legacy → sinh id mới; ghi đè masp + audit).
   Nguồn: proc-bodies/mes_dinhmuc_{govan,ngukim,donggoi}_copy.sql. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

interface CopyArgs {
  masp_nguon?: string;
  masp_dich?: string;
  nguoitao?: string;
}

async function copyDinhmuc(
  db: DB,
  companyId: string,
  entityName: string,
  loai: string,
  args: CopyArgs,
): Promise<Array<{ message: string; inserted: number }>> {
  const nguon = String(args.masp_nguon ?? "").trim();
  const dich = String(args.masp_dich ?? "").trim();
  if (!nguon || !dich) throw new Error("Chưa chọn sản phẩm nguồn / đích");
  if (nguon.toLowerCase() === dich.toLowerCase())
    throw new Error("Sản phẩm nguồn và đích không được giống nhau");

  const t = await procTable(db, companyId, entityName);

  // Đọc toàn bộ định mức SP nguồn (mọi field, kể cả ext).
  const src = await t.listWhere(sql`${t.text("masp")} = ${nguon}`);
  if (src.length === 0) throw new Error(`Định mức ${loai} của sản phẩm "${nguon}" không tồn tại`);

  const now = new Date().toISOString();
  const nguoi = String(args.nguoitao ?? "").trim() || null;

  // THAY THẾ: xoá định mức SP đích trước (hard-delete như proc gốc).
  await t.hardDeleteWhere(sql`${t.text("masp")} = ${dich}`);

  // Copy từng dòng — bỏ id vật lý (_id) + field id legacy → sinh mới.
  let inserted = 0;
  for (const row of src) {
    const data: Record<string, unknown> = { ...row };
    delete data._id; // uuid vật lý dòng nguồn — insertRow tự sinh mới
    delete data.id; // id legacy (int) — không copy, tránh trùng
    data.masp = dich;
    if ("ngaytao" in row) data.ngaytao = now;
    if ("nguoitao" in row) data.nguoitao = nguoi;
    if ("ngaysua" in row) data.ngaysua = now;
    if ("nguoisua" in row) data.nguoisua = nguoi;
    await t.insertRow(data);
    inserted++;
  }

  return [
    {
      message: `Đã copy ${inserted} dòng định mức ${loai} từ "${nguon}" sang "${dich}".`,
      inserted,
    },
  ];
}

export async function trDinhmucGovanCopy(db: DB, companyId: string, args: CopyArgs) {
  return copyDinhmuc(db, companyId, "tr_dinhmuc_govan", "gỗ ván", args);
}
export async function trDinhmucNgukimCopy(db: DB, companyId: string, args: CopyArgs) {
  return copyDinhmuc(db, companyId, "tr_dinhmuc_ngukim", "ngũ kim", args);
}
export async function trDinhmucDonggoiCopy(db: DB, companyId: string, args: CopyArgs) {
  return copyDinhmuc(db, companyId, "tr_dinhmuc_donggoi", "đóng gói", args);
}
