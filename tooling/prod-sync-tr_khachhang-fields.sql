-- prod-sync-tr_khachhang-fields.sql
-- Đồng bộ định nghĩa field entity tr_khachhang (Khách hàng) DEV -> PROD.
-- Lý do: form "Thêm/Sửa khách hàng" trên prod render theo entities.fields, mà
-- prod đang LỆCH so với dev ở 5 field (MCP migration KHÔNG sửa field sẵn có được
-- nên phải chạy SQL trực tiếp trên DB prod):
--   area          : text                 -> select   (opts: Trong nước / Ngoài nước)
--   customer_type : text "Loại khách hàng"-> multiselect "Khách mua" (Xuất khẩu / Vật tư nguyên liệu)
--   fax           : label "Số fax"        -> "Fax"
--   bank_id       : label "Ngân hàng"      -> "Ngân hàng thanh toán"
--   active        : "bool"/"Đang hoạt động"-> "boolean"/"Còn hợp tác"
-- 16 field còn lại giữ NGUYÊN (chỉ ghi đè để khớp hệt dev — tập field 2 bên trùng).
-- entity id = 5c138697-... ; company_id = 0000...0001 (trùng dev vì cùng dump).
-- CHỈ metadata field (widget form) — KHÔNG đụng dữ liệu bảng thật tr_khachhang.
--
-- An toàn: chạy trong transaction, soi trước/sau rồi mới COMMIT (đổi thành ROLLBACK
-- nếu thấy sai). Idempotent: chạy lại cũng cho cùng kết quả.

BEGIN;

-- (trước) soi 5 field đang lệch
SELECT jsonb_path_query(fields, '$[*] ? (@.name == "area" || @.name == "customer_type" || @.name == "fax" || @.name == "bank_id" || @.name == "active")')
FROM entities WHERE id = '5c138697-6875-40e5-b9fd-3451e241de0d';

UPDATE entities
SET fields = $json$[
  {"id":"fld_id","name":"id","type":"integer","label":"Id"},
  {"id":"fld_customer_id","name":"customer_id","type":"text","label":"Mã khách hàng"},
  {"id":"fld_customer_name","name":"customer_name","type":"text","label":"Tên khách hàng"},
  {"id":"fld_address","name":"address","type":"text","label":"Địa chỉ"},
  {"id":"fld_area","name":"area","type":"select","label":"Khu vực","options":["Trong nước","Ngoài nước"]},
  {"id":"fld_phone","name":"phone","type":"phone","label":"Số điện thoại"},
  {"id":"fld_fax","name":"fax","type":"text","label":"Fax"},
  {"id":"fld_email","name":"email","type":"email","label":"Email"},
  {"id":"fld_website","name":"website","type":"url","label":"Website"},
  {"id":"fld_director","name":"director","type":"text","label":"Giám đốc"},
  {"id":"fld_merchandiser","name":"merchandiser","type":"text","label":"Quản lý"},
  {"id":"fld_merchandiser_phone","name":"merchandiser_phone","type":"phone","label":"Điện thoại quản lý"},
  {"id":"fld_merchandiser_mail","name":"merchandiser_mail","type":"email","label":"Email quản lý"},
  {"id":"fld_ngaylamviec","name":"ngaylamviec","type":"datetime","label":"Ngày làm việc"},
  {"id":"fld_create_by","name":"create_by","type":"text","label":"Người tạo"},
  {"id":"fld_create_date","name":"create_date","type":"datetime","label":"Ngày tạo"},
  {"id":"fld_bank_id","name":"bank_id","type":"text","label":"Ngân hàng thanh toán"},
  {"id":"fld_taxcode","name":"taxcode","type":"text","label":"Mã số thuế"},
  {"id":"fld_active","name":"active","type":"boolean","label":"Còn hợp tác"},
  {"id":"fld_customer_type","name":"customer_type","type":"multiselect","label":"Khách mua","options":["Xuất khẩu","Vật tư nguyên liệu"]},
  {"id":"fld_customer_type_name","name":"customer_type_name","type":"text","label":"Tên loại khách hàng"}
]$json$::jsonb,
    updated_at = now()
WHERE id = '5c138697-6875-40e5-b9fd-3451e241de0d'
  AND company_id = '00000000-0000-0000-0000-000000000001';

-- (sau) xác nhận 5 field đã đổi đúng
SELECT jsonb_path_query(fields, '$[*] ? (@.name == "area" || @.name == "customer_type" || @.name == "fax" || @.name == "bank_id" || @.name == "active")')
FROM entities WHERE id = '5c138697-6875-40e5-b9fd-3451e241de0d';

-- Soi xong thấy đúng -> COMMIT; sai -> đổi dòng dưới thành ROLLBACK;
COMMIT;
