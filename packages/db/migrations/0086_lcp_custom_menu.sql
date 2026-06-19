-- Them cac muc menu tuy chinh cho "Lenh cap phat" (thu mua / G1004).
-- Moi muc co source_code CUST-LCP-* -- khong trung DQHF SYS_MENU_NEW.
-- ON CONFLICT DO NOTHING: an toan re-apply / chay tren nhieu moi truong.
-- page_id tra ve NULL neu trang chua ton tai (FK SET NULL -- khong fail).

INSERT INTO legacy_menu_map
  (id, company_id, source_id, source_code, name, level, parent_code,
   sort, custom, active, port_status, overrides, page_id, imported_at, updated_at)
SELECT
  gen_random_uuid(),
  c.id,
  0,
  v.source_code,
  v.name,
  v.level,
  v.parent_code,
  v.sort,
  true,
  true,
  'chua',
  v.overrides::jsonb,
  (SELECT p.id FROM pages p
   WHERE p.company_id = c.id AND p.name = v.page_name LIMIT 1),
  now(),
  now()
FROM companies c
CROSS JOIN (VALUES
  ('CUST-LCP-NKI',        'Ngu kim',            3, 'G1004',        100, '{"kind":"folder"}', NULL),
  ('CUST-LCP-NKI-BEFORE', 'Truoc son',           4, 'CUST-LCP-NKI',  1,  NULL,               'dq_p08_lcp_nki_before'),
  ('CUST-LCP-NKI-AFTER',  'Sau son',             4, 'CUST-LCP-NKI',  2,  NULL,               'dq_p08_lcp_nki_after'),
  ('CUST-LCP-NKI-AI',     'AI',                  4, 'CUST-LCP-NKI',  3,  NULL,               'dq_p08_lcp_nki_ai'),
  ('CUST-LCP-DGO',        'Bao bi, dong goi',   3, 'G1004',        101, NULL,               'dq_p08_lcp_dgo'),
  ('CUST-LCP-SON',        'Son',                 3, 'G1004',        102, NULL,               'dq_p08_lcp_son'),
  ('CUST-LCP-HTR',        'Hang trang',          3, 'G1004',        103, NULL,               'dq_p08_lcp_htr')
) AS v(source_code, name, level, parent_code, sort, overrides, page_name)
ON CONFLICT (company_id, source_code) DO NOTHING;

-- Gan trang tong hop "Lenh cap phat" vao muc I1274 (neu chua co page_id).
UPDATE legacy_menu_map
SET page_id = (
  SELECT p.id FROM pages p
  WHERE p.company_id = legacy_menu_map.company_id
    AND p.name = 'dq_p08_lenh_cap_phat_add'
  LIMIT 1
),
updated_at = now()
WHERE source_code = 'I1274'
  AND page_id IS NULL;
