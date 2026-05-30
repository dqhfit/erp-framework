-- Migration 0052: entities unique ten CASE-INSENSITIVE
-- Doi unique index (company_id, name) exact -> functional (company_id, lower(name))
-- de chong trung ten khong phan biet hoa/thuong + chong race (app-check khong
-- du khi 2 request dong thoi). Da kiem tra khong co du lieu trung case-insensitive
-- truoc khi doi (SELECT ... GROUP BY lower(name) HAVING count>1 = 0 rows).

DROP INDEX IF EXISTS entities_company_name_idx;
CREATE UNIQUE INDEX IF NOT EXISTS entities_company_name_idx
  ON entities (company_id, lower(name));
