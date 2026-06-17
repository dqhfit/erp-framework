-- ==========================================================
-- prod-fix-danhmuc-menu.sql   (chạy TRÊN DB PROD)
-- Dọn 3 node menu danh mục (đã gắn trang qua menu_link_pages):
--   (1) Bỏ đuôi "- bbiXxx" → tên sạch.
--   (2) Gom cấp: chuyển từ dưới I84 lên thẳng G0101 → hết cảnh
--       "Danh mục › Danh mục › Danh Mục", còn 2 cấp.
-- Menu render legacy_menu_map.name + cây theo parent_code → phải sửa
-- 2 cột này trực tiếp (MCP migration chỉ đọc, không ghi được).
--
-- Idempotent. company_id prod = 00000000-0000-0000-0000-000000000001
-- ==========================================================

BEGIN;

-- (1) Đổi name về tên sạch (bỏ đuôi "- bbiXxx")
UPDATE legacy_menu_map SET name = v.new_name, updated_at = now()
FROM (VALUES
  ('bbiHeHang',    'Hệ hàng'),
  ('bbiMauSac',    'Màu sắc'),
  ('bbiKhachHang', 'Khách hàng')
) AS v(source_code, new_name)
WHERE legacy_menu_map.company_id = '00000000-0000-0000-0000-000000000001'
  AND legacy_menu_map.source_code = v.source_code;

-- (2) Chuyển 3 node từ I84 (level 4) lên thẳng G0101 (level 3) → menu hiện
--     "Danh mục › Danh mục › trang" (2 cấp, bỏ được lớp I84 'Danh Mục' thứ 3).
--     sort nối tiếp sau con cuối hiện có của G0101 (max sort = 35).
UPDATE legacy_menu_map SET parent_code = 'G0101', level = 3, sort = v.sort, updated_at = now()
FROM (VALUES
  ('bbiHeHang',    36),
  ('bbiMauSac',    37),
  ('bbiKhachHang', 38)
) AS v(source_code, sort)
WHERE legacy_menu_map.company_id = '00000000-0000-0000-0000-000000000001'
  AND legacy_menu_map.source_code = v.source_code;

COMMIT;

-- Kiểm tra:
--   SELECT source_code, name, level, parent_code, sort, page_id, port_status
--   FROM legacy_menu_map WHERE source_code IN ('bbiHeHang','bbiMauSac','bbiKhachHang');
--   -- name sạch, parent_code='G0101', level=3 → menu "Danh mục › Danh mục › Hệ hàng"
