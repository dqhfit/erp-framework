-- ==========================================================
-- local-build-nhacungcap-page.sql   (chạy TRÊN DB LOCAL erp_sample)
-- Dựng trang danh mục "Nhà cung cấp" (list + form Thêm/Sửa/Xóa/Xem).
-- Form Thêm/Sửa: 2 BƯỚC (Thông tin NCC → Chuyển khoản), có dropdown
--   "Chủng cung cấp" (lookup tr_loaincc: value=id số 1-6, label=tên).
-- Entity tr_nhacc   = e9a159c5-d270-430a-ad67-6e2817f3b672
-- Entity tr_loaincc = f76e9a7e-5d87-46f6-a012-91b57cdd7549
-- Lookup KHÔNG cần đổi schema: ext.id (1-6) đã lộ thành data.id
--   (record-store toRecord spread ext vào data).
-- company_id = 00000000-0000-0000-0000-000000000001
-- Idempotent: chạy lại update đúng trang theo name.
-- ==========================================================

-- 1) Việt hóa label vài field tr_nhacc cho khớp hình
UPDATE entities
SET fields = (
  SELECT jsonb_agg(
    CASE
      WHEN f->>'name' = 'vendor_id' THEN jsonb_set(f, '{label}', '"Mã nhà cung cấp"')
      WHEN f->>'name' = 'loaincc'   THEN jsonb_set(f, '{label}', '"Chủng cung cấp"')
      WHEN f->>'name' = 'phone'     THEN jsonb_set(f, '{label}', '"Số điện thoại"')
      ELSE f END
  )
  FROM jsonb_array_elements(fields) f
), updated_at = now()
WHERE id = 'e9a159c5-d270-430a-ad67-6e2817f3b672'
  AND company_id = '00000000-0000-0000-0000-000000000001';

-- 2) Upsert trang "Nhà cung cấp"
WITH page_content AS (
  SELECT '[
    {
      "id": "w_list",
      "kind": "list",
      "x": 0, "y": 0, "w": 12, "h": 10,
      "config": {
        "title": "Nhà cung cấp",
        "entity": "e9a159c5-d270-430a-ad67-6e2817f3b672",
        "fields": [
          "vendor_id", "vendor_name", "address", "phone", "email",
          "sotaikhoan", "tentaikhoan", "tennganhang", "create_by", "create_date"
        ],
        "editable": false,
        "pageSize": 25,
        "rowLimit": 2000,
        "columnLabels": {
          "vendor_id": "Mã nhà cung cấp",
          "vendor_name": "Tên nhà cung cấp",
          "address": "Địa chỉ",
          "phone": "Số điện thoại",
          "email": "Email",
          "sotaikhoan": "Số tài khoản",
          "tentaikhoan": "Tên tài khoản",
          "tennganhang": "Ngân hàng",
          "create_by": "Người tạo",
          "create_date": "Ngày tạo"
        },
        "rowActions": [
          {
            "icon": "Eye",
            "label": "Xem chi tiết",
            "iconOnly": true,
            "variant": "default",
            "steps": [
              {
                "id": "v",
                "kind": "open-popup",
                "popupMode": "detail",
                "title": "Chi tiết nhà cung cấp",
                "entity": "e9a159c5-d270-430a-ad67-6e2817f3b672",
                "fields": [
                  "vendor_id", "loaincc", "vendor_name", "address", "phone",
                  "email", "website", "sotaikhoan", "tentaikhoan", "tennganhang",
                  "create_by", "create_date"
                ],
                "fieldLookups": {
                  "loaincc": {
                    "entity": "f76e9a7e-5d87-46f6-a012-91b57cdd7549",
                    "valueField": "id",
                    "labelFields": ["loaincc"]
                  }
                },
                "saveOutputTo": "_viewed"
              }
            ]
          },
          {
            "icon": "Edit",
            "label": "Sửa",
            "iconOnly": true,
            "variant": "default",
            "steps": [
              {
                "id": "e",
                "kind": "open-wizard",
                "title": "Sửa thông tin nhà cung cấp",
                "entity": "e9a159c5-d270-430a-ad67-6e2817f3b672",
                "submitLabel": "Lưu",
                "invalidateEntities": ["e9a159c5-d270-430a-ad67-6e2817f3b672"],
                "steps": [
                  {
                    "id": "st1",
                    "cols": 2,
                    "title": "Thông tin nhà cung cấp",
                    "fields": ["vendor_id", "loaincc", "vendor_name", "address", "phone", "email", "website"],
                    "fieldLookups": {
                      "loaincc": {
                        "entity": "f76e9a7e-5d87-46f6-a012-91b57cdd7549",
                        "valueField": "id",
                        "labelFields": ["loaincc"]
                      }
                    }
                  },
                  {
                    "id": "st2",
                    "cols": 1,
                    "title": "Thông tin chuyển khoản",
                    "fields": ["sotaikhoan", "tentaikhoan", "tennganhang"]
                  }
                ]
              }
            ]
          },
          {
            "icon": "Trash",
            "label": "Xóa",
            "iconOnly": true,
            "variant": "danger",
            "steps": [
              {
                "id": "c",
                "kind": "confirm",
                "danger": true,
                "title": "Xác nhận xóa",
                "message": "Xác nhận xoá nhà cung cấp này?"
              },
              {
                "id": "d",
                "kind": "delete-record",
                "recordIdBinding": { "value": "", "source": "const" },
                "invalidateEntities": ["e9a159c5-d270-430a-ad67-6e2817f3b672"]
              }
            ]
          }
        ],
        "embeddedActions": [
          {
            "id": "act_add",
            "icon": "Plus",
            "label": "Thêm",
            "variant": "primary",
            "steps": [
              {
                "id": "a",
                "kind": "open-wizard",
                "title": "Thêm nhà cung cấp",
                "entity": "e9a159c5-d270-430a-ad67-6e2817f3b672",
                "submitLabel": "Lưu",
                "invalidateEntities": ["e9a159c5-d270-430a-ad67-6e2817f3b672"],
                "steps": [
                  {
                    "id": "st1",
                    "cols": 2,
                    "title": "Thông tin nhà cung cấp",
                    "fields": ["vendor_id", "loaincc", "vendor_name", "address", "phone", "email", "website"],
                    "fieldLookups": {
                      "loaincc": {
                        "entity": "f76e9a7e-5d87-46f6-a012-91b57cdd7549",
                        "valueField": "id",
                        "labelFields": ["loaincc"]
                      }
                    }
                  },
                  {
                    "id": "st2",
                    "cols": 1,
                    "title": "Thông tin chuyển khoản",
                    "fields": ["sotaikhoan", "tentaikhoan", "tennganhang"]
                  }
                ]
              }
            ]
          }
        ],
        "selectionStateKey": "sel"
      }
    }
  ]'::jsonb AS content
),
upd AS (
  UPDATE pages p
  SET content = pc.content, label = 'Nhà cung cấp', icon = 'Truck',
      published = true, publish_mode = 'private', updated_at = now()
  FROM page_content pc
  WHERE p.company_id = '00000000-0000-0000-0000-000000000001'
    AND p.name = 'nha_cung_cap_e9a159'
  RETURNING p.id
)
INSERT INTO pages (id, name, label, icon, content, company_id, published, publish_mode, created_at, updated_at)
SELECT gen_random_uuid(), 'nha_cung_cap_e9a159', 'Nhà cung cấp', 'Truck',
       pc.content, '00000000-0000-0000-0000-000000000001', true, 'private', now(), now()
FROM page_content pc
WHERE NOT EXISTS (SELECT 1 FROM upd);

-- Kiểm tra:
--   SELECT id, name, label FROM pages
--   WHERE company_id='00000000-0000-0000-0000-000000000001' AND name='nha_cung_cap_e9a159';
