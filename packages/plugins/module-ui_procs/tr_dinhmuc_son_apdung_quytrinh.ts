/* Áp dụng quy trình sơn của 1 MÀU cho TẤT CẢ sản phẩm cùng màu → sinh
   định mức sơn (tr_dinhmuc_son). Mỗi (sản phẩm × bước × chi tiết) = 1 dòng.

   Nguồn:
   - tr_quytrinh_son        : các BƯỚC sơn của màu (lọc color_ref / mausac).
   - tr_quytrinh_son_chitiet: định mức CHI TIẾT mỗi bước (mact, dinhluong).
   - tr_material            : tên + đơn vị tính vật tư (mota, dvt).
   - tr_sanpham             : sản phẩm cùng màu (mausac = mã màu).

   Quy tắc (đã chốt với người dùng):
   - Áp dụng cho TẤT CẢ tr_sanpham có mausac = mã màu.
   - sl_m2 = dinhluong/1000 (nguồn GRAM → KG); m2 = 0 (cập nhật sau) → sl_sp = 0.
   - buoc = tenbuocson (nguyên văn).
   - Ghi đè theo (masp + mamau): soft-delete dòng cũ rồi insert mới.
   - Thiếu quy trình hoặc thiếu chi tiết → ném lỗi (UI hiện toast).

   Đây là logic NGHIỆP VỤ MỚI (không có proc DQHF gốc tương ứng — proc cũ
   TR_DINHMUC_SON_THEOMAU_INSERT2 chỉ insert 1 dòng định mức theo màu). */
import type { DB } from "@erp-framework/server/db";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

/** id_dinhmuc dạng hex 32 ký tự (giống dữ liệu cũ: GUID không dấu gạch). */
function newIdDinhmuc(): string {
  return randomUUID().replace(/-/g, "");
}

export async function trDinhmucSonApdungQuytrinh(
  db: DB,
  companyId: string,
  args: { colorRef?: string | null; mamau?: string | null },
): Promise<Array<{ mamau: string; products: number; rows: number; message: string }>> {
  const colorRef = args.colorRef ? String(args.colorRef) : "";

  // 1) Xác định MÃ MÀU (code). Ưu tiên tra theo colorRef (uuid tr_color).
  let code: string | null = args.mamau ? String(args.mamau) : null;
  if (colorRef) {
    const color = await procTable(db, companyId, "tr_color");
    const found = await color.listWhere(sql`id = ${colorRef}::uuid`, { limit: 1 });
    code = (found[0]?.code as string | undefined) ?? code;
  }
  if (!code) throw new Error("Chưa chọn màu sơn (hoặc không tìm thấy mã màu).");

  // 2) Các BƯỚC quy trình của màu (theo color_ref hoặc mausac), sắp theo stt.
  const qt = await procTable(db, companyId, "tr_quytrinh_son");
  const buoc = await qt.listWhere(
    sql`(${qt.text("color_ref")} = ${colorRef} OR ${qt.text("mausac")} = ${code})`,
    { orderBy: sql`${qt.num("stt")} ASC NULLS LAST` },
  );
  if (buoc.length === 0) {
    throw new Error(`Màu "${code}" chưa có quy trình sơn — hãy nhập quy trình trước khi áp dụng.`);
  }

  // 3) Gom danh sách dòng mẫu (bước × chi tiết) — chưa gắn sản phẩm.
  const ct = await procTable(db, companyId, "tr_quytrinh_son_chitiet");
  const mat = await procTable(db, companyId, "tr_material");
  const matCache = new Map<string, { tenct: string | null; dvt: string | null }>();

  type Line = {
    stt: string | null;
    buoc: string | null;
    id_buocson: number | null;
    mact: string | null;
    tenct: string | null;
    dvt: string | null;
    sl_m2: number | null;
  };
  const lines: Line[] = [];
  for (const b of buoc) {
    const idq = b.id_quytrinh;
    if (idq == null || String(idq).trim() === "") continue;
    // chi tiết f_id_quytrinh là numeric → so theo số.
    const dets = await ct.listWhere(sql`${ct.num("id_quytrinh")} = ${Number(idq)}`);
    for (const d of dets) {
      const mact = (d.mact as string | undefined) ?? null;
      let info = mact ? matCache.get(mact) : undefined;
      if (mact && !info) {
        const m = await mat.listWhere(sql`${mat.text("mavt")} = ${mact}`, { limit: 1 });
        info = {
          tenct: (m[0]?.mota as string | undefined) ?? null,
          dvt: (m[0]?.dvt as string | undefined) ?? null,
        };
        matCache.set(mact, info);
      }
      lines.push({
        stt: b.stt == null ? null : String(b.stt),
        buoc: (b.tenbuocson as string | undefined) ?? null,
        id_buocson: b.id_buocson == null ? null : Number(b.id_buocson),
        mact,
        tenct: info?.tenct ?? null,
        dvt: info?.dvt ?? null,
        // dinhluong nguồn (tr_quytrinh_son_chitiet) đơn vị GRAM → đổi sang KG
        // (÷1000) khi ghi sang tr_dinhmuc_son.sl_m2 (định mức /m²).
        sl_m2: d.dinhluong == null ? null : Number(d.dinhluong) / 1000,
      });
    }
  }
  if (lines.length === 0) {
    throw new Error(
      `Màu "${code}" có quy trình nhưng CHƯA có định mức chi tiết — hãy nhập chi tiết trước khi áp dụng.`,
    );
  }

  // 4) Sản phẩm cùng màu.
  const sp = await procTable(db, companyId, "tr_sanpham");
  const products = await sp.listWhere(sql`${sp.text("mausac")} = ${code}`);

  // 5) Mỗi sản phẩm: ghi đè (soft-delete masp+mamau) rồi insert dòng định mức.
  const dm = await procTable(db, companyId, "tr_dinhmuc_son");
  const now = new Date().toISOString();
  let rowCount = 0;
  for (const p of products) {
    const masp = (p.masp as string | undefined) ?? null;
    if (!masp) continue;
    await dm.softDeleteWhere(
      sql`${dm.text("masp")} = ${masp} AND ${dm.text("mamau")} = ${code}`,
    );
    for (const ln of lines) {
      await dm.insertRow({
        masp,
        mamau: code,
        stt: ln.stt,
        buoc: ln.buoc,
        id_buocson: ln.id_buocson,
        mact: ln.mact,
        tenct: ln.tenct,
        dvt: ln.dvt,
        sl_m2: ln.sl_m2,
        m2: 0,
        sl_sp: 0,
        id_dinhmuc: newIdDinhmuc(),
        ngaytao: now,
      });
      rowCount++;
    }
  }

  const message =
    products.length === 0
      ? `Màu "${code}" không có sản phẩm nào cùng màu — không tạo định mức nào.`
      : `Đã áp dụng quy trình màu "${code}" cho ${products.length} sản phẩm — ${rowCount} dòng định mức (ghi đè dữ liệu cũ).`;
  return [{ mamau: code, products: products.length, rows: rowCount, message }];
}
