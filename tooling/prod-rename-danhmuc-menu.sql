-- ==========================================================
-- prod-rename-danhmuc-menu.sql   (chạy TRÊN DB PROD)
-- Đổi tên hiển thị 3 node menu danh mục về đúng tên trang
-- (bỏ đuôi legacy "- bbiXxx"). Menu render legacy_menu_map.name,
-- KHÔNG lấy page.label → phải sửa cột name trực tiếp.
--
-- 3 node này đã được menu_link_pages gắn page_id + port_status='xong'
-- (2026-06-17); script này CHỈ đổi name. Idempotent, chạy lại vô hại.
--
-- ⚠ Re-import menu từ MSSQL (resolveFromSource/importFromMssql) sẽ GHI ĐÈ
--   name về tên nguồn → chạy lại script này sau mỗi lần re-import nếu cần.
-- company_id prod = 00000000-0000-0000-0000-000000000001
-- ==========================================================

UPDATE legacy_menu_map
SET name = v.new_name, updated_at = now()
FROM (VALUES
  ('bbiHeHang',    'Hệ hàng'),
  ('bbiMauSac',    'Màu sắc'),
  ('bbiKhachHang', 'Khách hàng')
) AS v(source_code, new_name)
WHERE legacy_menu_map.company_id = '00000000-0000-0000-0000-000000000001'
  AND legacy_menu_map.source_code = v.source_code
  AND legacy_menu_map.name <> v.new_name;

-- Kiểm tra:
--   SELECT source_code, name, page_id, port_status FROM legacy_menu_map
--   WHERE source_code IN ('bbiHeHang','bbiMauSac','bbiKhachHang');
