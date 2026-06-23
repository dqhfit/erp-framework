/* Tạo dữ liệu yêu cầu mua hàng từ định mức × đơn hàng đã chọn.
   Args: loai (Ngũ kim|Đóng gói|Sơn), orders (string[] — mảng order_number).
   Xoá hết dữ liệu cũ cùng loại trước khi insert, rồi insert lại.
   Gọi từ nút "Tải dữ liệu" trên trang c81743af. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";

const ENTITY_ID = "e9100001-0000-4000-8000-000000000001";

/** Tạo mệnh đề IN cho mảng order_number (dùng sql.join thay ANY để tránh
 *  vấn đề serialize array của drizzle+postgres-js). */
function ordersIn(orders: string[]) {
  return sql.join(
    orders.map((o) => sql`${o}`),
    sql`, `,
  );
}

async function getCount(db: DB, companyId: string, loai: string): Promise<number> {
  const r = (await db.execute(sql`
    SELECT count(*)::int n FROM tr_yc_mua_hang
    WHERE company_id = ${companyId}::uuid AND f_loai_don_hang = ${loai}
  `)) as unknown as Array<{ n?: number }>;
  return Number(r[0]?.n ?? 0);
}

export async function buildYcMuaHang(
  db: DB,
  companyId: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; loai: string; inserted: number; message: string }[]> {
  const loai = String(args.loai ?? "").trim();
  const orders = Array.isArray(args.orders) ? (args.orders as string[]).filter(Boolean) : [];

  if (!loai) return [{ ok: false, loai: "", inserted: 0, message: "Chưa chọn Loại đơn hàng." }];
  if (!orders.length) return [{ ok: false, loai, inserted: 0, message: "Chưa chọn Đơn hàng." }];

  const loaiLower = loai.toLowerCase().trim();
  const inClause = ordersIn(orders);

  // Phân nhánh theo loại — dùng từ khoá KHÔNG nhập nhằng (tránh bug "đóng gói"
  // chứa "ng" → nhầm sang ngũ kim). "kim" chỉ có ở Ngũ kim; "gói/đóng" chỉ ở
  // Đóng gói; "sơn/son" chỉ ở Sơn.
  const isNguKim = loaiLower.includes("kim");
  const isDongGoi =
    loaiLower.includes("gói") ||
    loaiLower.includes("goi") ||
    loaiLower.includes("đóng") ||
    loaiLower.includes("dong");
  const isSon = loaiLower.includes("sơn") || loaiLower.includes("son");
  if (!isNguKim && !isDongGoi && !isSon) {
    return [{ ok: false, loai, inserted: 0, message: `Loại đơn hàng không hợp lệ: ${loai}` }];
  }

  // Reset TOÀN BỘ working set của công ty mỗi lần tải → list luôn phản ánh đúng
  // lựa chọn hiện tại (kể cả khi lần này 0 dòng thì list cũng rỗng, không còn
  // sót dữ liệu của lần tải loại trước).
  await db.execute(sql`
    DELETE FROM tr_yc_mua_hang
    WHERE company_id = ${companyId}::uuid
  `);

  if (isNguKim) {
    // Ngũ kim — dinhmuc_ngukim.f_mavt → tr_material.f_mavt
    await db.execute(sql`
      INSERT INTO tr_yc_mua_hang
        (company_id, f_loai_don_hang, f_order_number, f_masp, f_mavt, f_mota,
         f_quycach, f_mausac, f_dvt, f_nhom,
         f_sl_don_hang, f_sl_dinhmuc, f_sl_can, f_dongia, f_loai_tien, f_ma_ncc)
      SELECT
        ${companyId}::uuid, ${loai},
        od.f_order_number, dk.f_masp, dk.f_mavt, COALESCE(m.f_mota, dk.f_chitiet),
        COALESCE(m.f_quycach, dk.f_quycach), m.f_mausac,
        COALESCE(dk.f_dvt, m.f_dvt), COALESCE(dk.f_nhom, m.f_nhom),
        COALESCE(od.f_order_qty, 0), COALESCE(dk.f_soluong, 0),
        ROUND(COALESCE(od.f_order_qty, 0) * COALESCE(dk.f_soluong, 0), 4),
        COALESCE((m.ext->>'dongia')::numeric, 0), m.f_loaitien, m.f_mancc
      FROM tr_dinhmuc_ngukim dk
      JOIN tr_order_detail od
        ON od.f_item_number = dk.f_masp
       AND od.company_id = ${companyId}::uuid
       AND od.deleted_at IS NULL
       AND od.f_order_number IN (${inClause})
      LEFT JOIN tr_material m
        ON m.f_mavt = dk.f_mavt
       AND m.company_id = ${companyId}::uuid
       AND m.deleted_at IS NULL
      WHERE dk.company_id = ${companyId}::uuid AND dk.deleted_at IS NULL
    `);
  } else if (isDongGoi) {
    // Đóng gói — dinhmuc_donggoi.f_madonggoi → tr_material.f_mavt
    await db.execute(sql`
      INSERT INTO tr_yc_mua_hang
        (company_id, f_loai_don_hang, f_order_number, f_masp, f_mavt, f_mota,
         f_quycach, f_mausac, f_dvt, f_nhom,
         f_sl_don_hang, f_sl_dinhmuc, f_sl_can, f_dongia, f_loai_tien, f_ma_ncc)
      SELECT
        ${companyId}::uuid, ${loai},
        od.f_order_number, dk.f_masp, dk.f_madonggoi, COALESCE(m.f_mota, dk.f_chitiet),
        COALESCE(m.f_quycach, dk.f_quycach), m.f_mausac,
        COALESCE(dk.f_dvt, m.f_dvt), COALESCE(dk.f_nhom, m.f_nhom),
        COALESCE(od.f_order_qty, 0), COALESCE(dk.f_soluong, 0),
        ROUND(COALESCE(od.f_order_qty, 0) * COALESCE(dk.f_soluong, 0), 4),
        COALESCE((m.ext->>'dongia')::numeric, 0), m.f_loaitien, m.f_mancc
      FROM tr_dinhmuc_donggoi dk
      JOIN tr_order_detail od
        ON od.f_item_number = dk.f_masp
       AND od.company_id = ${companyId}::uuid
       AND od.deleted_at IS NULL
       AND od.f_order_number IN (${inClause})
      LEFT JOIN tr_material m
        ON m.f_mavt = dk.f_madonggoi
       AND m.company_id = ${companyId}::uuid
       AND m.deleted_at IS NULL
      WHERE dk.company_id = ${companyId}::uuid AND dk.deleted_at IS NULL
    `);
  } else {
    // Sơn — dinhmuc_son.f_mact → tr_material.f_mavt, qty = f_sl_sp
    await db.execute(sql`
      INSERT INTO tr_yc_mua_hang
        (company_id, f_loai_don_hang, f_order_number, f_masp, f_mavt, f_mota,
         f_quycach, f_mausac, f_dvt, f_nhom,
         f_sl_don_hang, f_sl_dinhmuc, f_sl_can, f_dongia, f_loai_tien, f_ma_ncc)
      SELECT
        ${companyId}::uuid, ${loai},
        od.f_order_number, dk.f_masp, dk.f_mact, COALESCE(m.f_mota, dk.f_tenct),
        m.f_quycach, m.f_mausac,
        COALESCE(dk.f_dvt, m.f_dvt), COALESCE(dk.f_nhom, m.f_nhom),
        COALESCE(od.f_order_qty, 0), COALESCE(dk.f_sl_sp, 0),
        ROUND(COALESCE(od.f_order_qty, 0) * COALESCE(dk.f_sl_sp, 0), 4),
        COALESCE((m.ext->>'dongia')::numeric, 0), m.f_loaitien, m.f_mancc
      FROM tr_dinhmuc_son dk
      JOIN tr_order_detail od
        ON od.f_item_number = dk.f_masp
       AND od.company_id = ${companyId}::uuid
       AND od.deleted_at IS NULL
       AND od.f_order_number IN (${inClause})
      LEFT JOIN tr_material m
        ON m.f_mavt = dk.f_mact
       AND m.company_id = ${companyId}::uuid
       AND m.deleted_at IS NULL
      WHERE dk.company_id = ${companyId}::uuid AND dk.deleted_at IS NULL
    `);
  }

  // record_locator cho dòng mới
  await db.execute(sql`
    INSERT INTO record_locator (id, company_id, entity_id)
    SELECT id, company_id, ${ENTITY_ID}::uuid FROM tr_yc_mua_hang
    WHERE company_id = ${companyId}::uuid AND f_loai_don_hang = ${loai}
    ON CONFLICT (id) DO NOTHING
  `);

  const inserted = await getCount(db, companyId, loai);
  return [
    { ok: true, loai, inserted, message: `Đã tạo ${inserted} dòng yêu cầu mua hàng (${loai}).` },
  ];
}
