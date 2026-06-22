/* Setup cho trang c81743af (Tạo y/c mua hàng): tạo bảng tr_yc_mua_hang + entity.
   Idempotent — chạy lại vô hại. Gọi qua migration_invoke_module_proc. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";

const ENTITY_ID = "e9100001-0000-4000-8000-000000000001";

const ENTITY = {
  id: ENTITY_ID,
  name: "tr_yc_mua_hang",
  label: "Yêu cầu mua hàng",
  fields: [
    { name: "loai_don_hang", type: "text", label: "Loại đơn hàng" },
    { name: "order_number", type: "text", label: "Mã đơn hàng" },
    { name: "masp", type: "text", label: "Mã sản phẩm" },
    { name: "mavt", type: "text", label: "Mã chi tiết" },
    { name: "mota", type: "text", label: "Tên chi tiết" },
    { name: "quycach", type: "text", label: "Quy cách" },
    { name: "mausac", type: "text", label: "Màu sắc" },
    { name: "dvt", type: "text", label: "Đơn vị tính" },
    { name: "nhom", type: "text", label: "Nhóm chi tiết" },
    { name: "sl_don_hang", type: "number", label: "Số lượng đơn hàng" },
    { name: "sl_dinhmuc", type: "number", label: "Định mức" },
    { name: "sl_can", type: "number", label: "Số lượng cần" },
    { name: "dongia", type: "number", label: "Đơn giá" },
    { name: "thanh_tien", type: "number", label: "Thành tiền" },
    { name: "loai_tien", type: "text", label: "Loại tiền" },
    {
      name: "ma_ncc",
      type: "lookup",
      label: "Nhà cung cấp",
      ref: "e9a159c5-d270-430a-ad67-6e2817f3b672",
      refValueField: "vendor_id",
    },
    { name: "ngay_giao", type: "date", label: "Ngày cần giao" },
    { name: "ghichu", type: "text", label: "Ghi chú" },
  ],
  meta: {
    sync: { state: "live" },
    storage: {
      tier: "table",
      tableName: "tr_yc_mua_hang",
      columns: {
        loai_don_hang: { col: "f_loai_don_hang", pgType: "text" },
        order_number: { col: "f_order_number", pgType: "text" },
        masp: { col: "f_masp", pgType: "text" },
        mavt: { col: "f_mavt", pgType: "text" },
        mota: { col: "f_mota", pgType: "text" },
        quycach: { col: "f_quycach", pgType: "text" },
        mausac: { col: "f_mausac", pgType: "text" },
        dvt: { col: "f_dvt", pgType: "text" },
        nhom: { col: "f_nhom", pgType: "text" },
        sl_don_hang: { col: "f_sl_don_hang", pgType: "numeric" },
        sl_dinhmuc: { col: "f_sl_dinhmuc", pgType: "numeric" },
        sl_can: { col: "f_sl_can", pgType: "numeric" },
        dongia: { col: "f_dongia", pgType: "numeric" },
        thanh_tien: { col: "f_thanh_tien", pgType: "numeric" }, // generated: sl_can * dongia
        loai_tien: { col: "f_loai_tien", pgType: "text" },
        ma_ncc: { col: "f_ma_ncc", pgType: "text" }, // lookup → tr_nhacc.vendor_id
        ngay_giao: { col: "f_ngay_giao", pgType: "date" },
        ghichu: { col: "f_ghichu", pgType: "text" },
      },
      version: 1,
      searchable: [],
    },
  },
};

export async function setupYcMuaHang(
  db: DB,
  companyId: string,
  _args: Record<string, unknown>,
): Promise<{ ok: boolean; message: string }[]> {
  // 1) Tạo bảng
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tr_yc_mua_hang (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      company_id uuid NOT NULL,
      f_loai_don_hang text,
      f_order_number text,
      f_masp text,
      f_mavt text,
      f_mota text,
      f_quycach text,
      f_mausac text,
      f_dvt text,
      f_nhom text,
      f_sl_don_hang numeric,
      f_sl_dinhmuc numeric,
      f_sl_can numeric,
      f_dongia numeric,
      f_thanh_tien numeric GENERATED ALWAYS AS (COALESCE(f_sl_can, 0) * COALESCE(f_dongia, 0)) STORED,
      f_loai_tien text,
      f_ma_ncc text,
      f_ngay_giao date,
      f_ghichu text,
      ext jsonb,
      version integer DEFAULT 0,
      deleted_at timestamptz,
      created_by uuid,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    )
  `);

  // 1b) Bảng đã tồn tại trước đây → bổ sung cột generated "thành tiền" (idempotent).
  await db.execute(sql`
    ALTER TABLE tr_yc_mua_hang
      ADD COLUMN IF NOT EXISTS f_thanh_tien numeric
      GENERATED ALWAYS AS (COALESCE(f_sl_can, 0) * COALESCE(f_dongia, 0)) STORED
  `);

  // 2) Đăng ký entity
  await db.execute(sql`
    INSERT INTO entities (id, company_id, name, label, icon, fields, meta, created_at, updated_at)
    VALUES (
      ${ENTITY_ID}::uuid, ${companyId}::uuid,
      ${ENTITY.name}, ${ENTITY.label}, null,
      ${JSON.stringify(ENTITY.fields)}::jsonb,
      ${JSON.stringify(ENTITY.meta)}::jsonb,
      now(), now()
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, label = EXCLUDED.label,
      fields = EXCLUDED.fields, meta = EXCLUDED.meta, updated_at = now()
  `);

  // 3) record_locator cho dữ liệu hiện có (nếu có)
  await db.execute(sql`
    INSERT INTO record_locator (id, company_id, entity_id)
    SELECT id, company_id, ${ENTITY_ID}::uuid FROM tr_yc_mua_hang
    WHERE company_id = ${companyId}::uuid
    ON CONFLICT (id) DO NOTHING
  `);

  return [{ ok: true, message: `Bảng tr_yc_mua_hang + entity đã sẵn sàng.` }];
}
