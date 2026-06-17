-- ==========================================================
-- prod-unlink-danhmuc-menu.sql   (chạy TRÊN DB PROD)
-- Gỡ 3 node menu danh mục VỀ trạng thái "chưa gắn":
--   page_id = NULL, port_status = 'chua'
-- → đảo ngược menu_link_pages (2026-06-17). GIỮ NGUYÊN 3 trang
--   (mau_sac/he_hang/khach_hang) — chỉ tháo liên kết menu.
--
-- LƯU Ý: nếu mục đích cuối là XÓA TRANG thì KHÔNG cần script này —
--   FK legacy_menu_map.page_id là ON DELETE SET NULL, nên xóa trang
--   tự động gỡ link (port_status vẫn 'xong', muốn về 'chua' thì chạy phần
--   UPDATE port_status dưới đây).
--
-- Idempotent. company_id prod = 00000000-0000-0000-0000-000000000001
-- ==========================================================

UPDATE legacy_menu_map
SET page_id = NULL, port_status = 'chua', updated_at = now()
WHERE company_id = '00000000-0000-0000-0000-000000000001'
  AND source_code IN ('bbiHeHang', 'bbiMauSac', 'bbiKhachHang');

-- Kiểm tra:
--   SELECT source_code, name, page_id, port_status FROM legacy_menu_map
--   WHERE source_code IN ('bbiHeHang','bbiMauSac','bbiKhachHang');
--   -- page_id phải = NULL, port_status = 'chua'
