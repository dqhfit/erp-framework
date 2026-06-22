/* Tạo đơn đặt hàng từ working set tr_yc_mua_hang.
   - Mỗi nhà cung cấp (f_ma_ncc) → 1 đơn hàng (tr_dondathang) + nhiều dòng chi tiết
     (tr_dondathang_chitiet).
   - Mã đơn hàng: MANCC-MACONGTY{STT}/MMyyyy
       MANCC    = mã nhà cung cấp
       MACONGTY = mã công ty (hr_congty.f_macty, tra theo tên công ty đang chọn)
       STT      = số thứ tự đơn trong tháng (tiếp nối đơn đã có), 2 chữ số
       MMyyyy   = tháng + năm
   Args: { congty?: string }  // tên công ty (selCty) để suy mã công ty.
   Gọi từ nút "Tạo đơn hàng" trên trang c81743af. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";

type Row = Record<string, unknown>;

export async function createDonDatHang(
  db: DB,
  companyId: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; created: number; skipped: number; message: string }[]> {
  const congty = String(args.congty ?? "").trim();

  // 1) BẮT BUỘC chọn công ty — không chọn thì KHÔNG cho tạo đơn.
  if (!congty) {
    return [
      {
        ok: false,
        created: 0,
        skipped: 0,
        message: "Vui lòng chọn công ty trước khi tạo đơn hàng.",
      },
    ];
  }
  // Khớp linh hoạt: congty có thể là MÃ công ty (combobox lưu f_macty) hoặc TÊN
  // (giá trị cũ) — so cả 2, đã trim, ưu tiên khớp theo mã. Thử scope theo tenant
  // trước; không thấy thì tra toàn bộ hr_congty (master data — tránh lệch
  // active company gây không tìm ra).
  // LƯU Ý: db.execute() trả về MẢNG rows trực tiếp (postgres-js), KHÔNG có `.rows`.
  const lookupCty = async (scoped: boolean) =>
    (await db.execute(sql`
      SELECT f_macty FROM hr_congty
      WHERE deleted_at IS NULL
        ${scoped ? sql`AND company_id = ${companyId}::uuid` : sql``}
        AND (trim(f_macty) = ${congty} OR trim(f_tencty) = ${congty})
      ORDER BY (trim(f_macty) = ${congty}) DESC
      LIMIT 1
    `)) as unknown as Row[];
  let ctyRows = await lookupCty(true);
  if (!ctyRows[0]) ctyRows = await lookupCty(false);
  const macongty = String(ctyRows[0]?.f_macty ?? "").trim();
  if (!macongty) {
    return [
      { ok: false, created: 0, skipped: 0, message: `Không tìm thấy công ty cho "${congty}".` },
    ];
  }

  // 2) Lấy working set hiện tại
  const allRows = (await db.execute(sql`
      SELECT f_ma_ncc, f_order_number, f_masp, f_mavt, f_mota, f_dvt,
             f_sl_can, f_dongia, f_loai_tien, f_ngay_giao, f_ghichu, f_loai_don_hang
      FROM tr_yc_mua_hang
      WHERE company_id = ${companyId}::uuid
    `)) as unknown as Row[];

  // Chỉ tạo đơn cho dòng HỢP LỆ: đã chọn NCC + số lượng > 0 + đơn giá > 0.
  const valid = allRows.filter(
    (r) =>
      String(r.f_ma_ncc ?? "").trim() !== "" &&
      (Number(r.f_sl_can ?? 0) || 0) > 0 &&
      (Number(r.f_dongia ?? 0) || 0) > 0,
  );
  const skipped = allRows.length - valid.length;
  if (valid.length === 0) {
    return [
      {
        ok: false,
        created: 0,
        skipped,
        message:
          "Không có dòng hợp lệ để tạo đơn (cần có nhà cung cấp, số lượng > 0 và đơn giá > 0).",
      },
    ];
  }

  // Gom theo nhà cung cấp
  const groups = new Map<string, Row[]>();
  for (const r of valid) {
    const k = String(r.f_ma_ncc).trim();
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }

  // 3) Ngày + số thứ tự trong tháng (tiếp nối đơn đã có cùng tháng)
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = String(now.getFullYear());
  const dd = String(now.getDate()).padStart(2, "0");
  const monthSuffix = `/${mm}${yyyy}`;
  const ngaydat = `${yyyy}-${mm}-${dd}`;
  const createDate = now.toISOString();

  const cntRows = (await db.execute(sql`
    SELECT count(*)::int n FROM tr_dondathang
    WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
      AND f_maddh LIKE ${`%${monthSuffix}`}
  `)) as unknown as Row[];
  let seq = Number(cntRows[0]?.n ?? 0);

  let created = 0;
  for (const [ncc, items] of groups) {
    seq += 1;
    const maddh = `${ncc}-${macongty}${String(seq).padStart(2, "0")}${monthSuffix}`;
    const loai = String(items[0].f_loai_don_hang ?? "");
    const loaitien = String(items[0].f_loai_tien ?? "");
    // Mã loại đơn hàng (f_loaiddh): Ngũ kim→NKI, Đóng gói→DGO, Sơn→SON.
    const loaiLow = loai.toLowerCase();
    const loaiddh = loaiLow.includes("kim")
      ? "NKI"
      : loaiLow.includes("gói") ||
          loaiLow.includes("goi") ||
          loaiLow.includes("đóng") ||
          loaiLow.includes("dong")
        ? "DGO"
        : loaiLow.includes("sơn") || loaiLow.includes("son")
          ? "SON"
          : "";

    // Tên nhà cung cấp
    const nrRows = (await db.execute(sql`
      SELECT f_vendor_name FROM tr_nhacc
      WHERE company_id = ${companyId}::uuid AND f_vendor_id = ${ncc} AND deleted_at IS NULL
      LIMIT 1
    `)) as unknown as Row[];
    const tenncc = String(nrRows[0]?.f_vendor_name ?? "");

    // Header
    await db.execute(sql`
      INSERT INTO tr_dondathang
        (company_id, f_maddh, f_tenddh, f_mancc, f_tenncc, f_macongty,
         f_loaidonhang, f_loaiddh, f_ngaydat, f_trangthai, f_active, f_create_date, ext)
      VALUES
        (${companyId}::uuid, ${maddh}, ${`Đơn đặt hàng ${tenncc || ncc}`}, ${ncc}, ${tenncc},
         ${macongty}, ${loai}, ${loaiddh}, ${ngaydat}, ${"0"}, true, ${createDate},
         ${JSON.stringify({ loaitien, nguon: "tr_yc_mua_hang" })}::jsonb)
    `);

    // Chi tiết
    for (const it of items) {
      const slcan = Number(it.f_sl_can ?? 0) || 0;
      await db.execute(sql`
        INSERT INTO tr_dondathang_chitiet
          (company_id, f_maddh, f_masp, f_chitiet, f_tenchitiet, f_soluong, f_dvt,
           f_sl_danhan, f_sl_conlai, f_loaitien, f_donhang, f_ngaycangiao, f_ghichu,
           f_create_date, ext)
        VALUES
          (${companyId}::uuid, ${maddh}, ${String(it.f_masp ?? "")}, ${String(it.f_mavt ?? "")},
           ${String(it.f_mota ?? "")}, ${slcan}, ${String(it.f_dvt ?? "")},
           0, ${slcan}, ${String(it.f_loai_tien ?? "")}, ${String(it.f_order_number ?? "")},
           ${it.f_ngay_giao == null ? null : String(it.f_ngay_giao)}, ${String(it.f_ghichu ?? "")},
           ${createDate}, ${JSON.stringify({ dongia: Number(it.f_dongia ?? 0) || 0 })}::jsonb)
      `);
    }
    created += 1;
  }

  // record_locator cho header + chi tiết → records.update/delete định tuyến được
  // theo id (proc INSERT thẳng nên phải tự ghi locator, khác API insert tự ghi).
  await db.execute(sql`
    INSERT INTO record_locator (id, company_id, entity_id)
    SELECT id, company_id, '7739eee9-fb60-45b6-9f79-8567c7e21e12'::uuid
    FROM tr_dondathang WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO record_locator (id, company_id, entity_id)
    SELECT id, company_id, 'bbebb6f3-0208-4f10-af62-557491c42f49'::uuid
    FROM tr_dondathang_chitiet WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
    ON CONFLICT (id) DO NOTHING
  `);

  const msg =
    `Đã tạo ${created} đơn hàng (mỗi NCC 1 đơn).` +
    (skipped > 0
      ? ` Bỏ qua ${skipped} dòng không hợp lệ (chưa chọn NCC / số lượng ≤ 0 / đơn giá ≤ 0).`
      : "");
  return [{ ok: true, created, skipped, message: msg }];
}
