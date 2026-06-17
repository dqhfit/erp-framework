-- prod-sync-tr_color-fields.sql
-- Đồng bộ định nghĩa field entity tr_color (Bảng màu) DEV -> PROD bằng 1 lệnh.
-- Làm form "Thêm/Sửa màu sơn" trên prod GIỐNG dev: phanloai=select, hinhanh=image
-- (tự ra layout 2 cột + ô upload ảnh), ghichu=longtext "Thông tin", + các nhãn
-- (Nhà cung cấp sơn / Đơn giá sơn (VND) / Quy trình sơn / Báo cáo test).
-- Tập 19 field 2 bên KHỚP tên → đè cả mảng an toàn (chỉ đổi type/label/options/required).
-- CHỈ metadata field — KHÔNG đụng dữ liệu bảng tr_color.
-- entity id = 75a7b609-... ; chạy trên DB PROD.

BEGIN;
UPDATE entities
SET fields = $json${pretty}$json$::jsonb,
    updated_at = now()
WHERE id = '75a7b609-a322-4808-9cd8-4635090e603f'
  AND company_id = '00000000-0000-0000-0000-000000000001';

-- soi lại 4 field chính rồi COMMIT (sai thì ROLLBACK)
SELECT jsonb_path_query(fields, '$[*] ? (@.name=="phanloai" || @.name=="hinhanh" || @.name=="ghichu" || @.name=="dongia")')
FROM entities WHERE id='75a7b609-a322-4808-9cd8-4635090e603f';
COMMIT;
