/* Port UPDATEMATERIALCODE — đồng bộ thông tin vật tư sang các bảng định mức
   + chi tiết đơn hàng + lệnh cấp phát theo mã idxuong.
   Nguồn: migration-plan/ui/proc-bodies/updatematerialcode.sql
   Đọc/ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   f_... hoặc ext của bảng thật, tự version/updated_at, guard mirror).

   Đọc 1 row tr_material theo idxuong (mota/quycach/dvt/nhom/mausac — tenvt
   T-SQL có đọc nhưng không dùng, bỏ) rồi update 5 bảng:
   - tr_dinhmuc_donggoi  (chitiet/quycach/dvt           WHERE madonggoi)
   - tr_dinhmuc_ngukim   (chitiet/quycach/dvt/nhom      WHERE mavt)
   - tr_dinhmuc_son      (tenct/nhom/dvt                WHERE mact) — bảng CHƯA
     migrate sang bảng thật: bọc try/catch riêng, lỗi → skip + warning.
   - tr_dondathang_chitiet (tenchitiet/dvt              WHERE chitiet)
   - tr_lenhcapphat      (mota/dvt/quycach/mausac/nhom  WHERE mavt)

   Khác T-SQL gốc: gốc không kiểm tra vật tư tồn tại — biến NULL sẽ ghi NULL
   đè 5 bảng; ở đây fail-safe THROW khi không tìm thấy idxuong để khỏi xoá
   trắng dữ liệu vì gõ sai mã. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function updateMaterialCode(
  db: DB,
  companyId: string,
  args: {
    code: string;
  },
): Promise<{ updated: Record<string, number>; warnings: string[] }> {
  if (!args.code) throw new Error("Thiếu code");

  const updated: Record<string, number> = {};
  const warnings: string[] = [];

  // Đọc thông tin vật tư nguồn theo idxuong
  const tMat = await procTable(db, companyId, "tr_material");
  const [mat] = await tMat.listWhere(sql`${tMat.text("idxuong")} = ${args.code}`, { limit: 1 });
  if (!mat) {
    throw new Error(`Không tìm thấy vật tư idxuong = "${args.code}" trong tr_material`);
  }

  const asText = (v: unknown): string | null => (v == null ? null : String(v));
  const mota = asText(mat.mota);
  const quycach = asText(mat.quycach);
  const dvt = asText(mat.dvt);
  const nhom = asText(mat.nhom);
  const mausac = asText(mat.mausac);

  // 1. Định mức đóng gói
  const tDonggoi = await procTable(db, companyId, "tr_dinhmuc_donggoi");
  updated.tr_dinhmuc_donggoi = await tDonggoi.updateWhere(
    { chitiet: mota, quycach, dvt },
    sql`${tDonggoi.text("madonggoi")} = ${args.code}`,
  );

  // 2. Định mức ngũ kim
  const tNgukim = await procTable(db, companyId, "tr_dinhmuc_ngukim");
  updated.tr_dinhmuc_ngukim = await tNgukim.updateWhere(
    { chitiet: mota, quycach, dvt, nhom },
    sql`${tNgukim.text("mavt")} = ${args.code}`,
  );

  // 3. Định mức sơn — bảng CHƯA migrate (không có trong field-map):
  //    procTable sẽ throw "không tồn tại"/"không phải bảng thật" → skip + warning
  try {
    const tSon = await procTable(db, companyId, "tr_dinhmuc_son");
    updated.tr_dinhmuc_son = await tSon.updateWhere(
      { tenct: mota, nhom, dvt },
      sql`${tSon.text("mact")} = ${args.code}`,
    );
  } catch (err) {
    warnings.push(
      `Bỏ qua tr_dinhmuc_son (bảng chưa migrate): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 4. Chi tiết đơn đặt hàng
  const tDdhCt = await procTable(db, companyId, "tr_dondathang_chitiet");
  updated.tr_dondathang_chitiet = await tDdhCt.updateWhere(
    { tenchitiet: mota, dvt },
    sql`${tDdhCt.text("chitiet")} = ${args.code}`,
  );

  // 5. Lệnh cấp phát
  const tLcp = await procTable(db, companyId, "tr_lenhcapphat");
  updated.tr_lenhcapphat = await tLcp.updateWhere(
    { mota, dvt, quycach, mausac, nhom },
    sql`${tLcp.text("mavt")} = ${args.code}`,
  );

  return { updated, warnings };
}
