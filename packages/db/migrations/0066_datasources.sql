-- 0066_datasources.sql
-- Bang nguon du lieu (DataSource) -- doi tuong hang nhat kieu ORM.
-- Gop field tu nhieu entity lien quan (join qua lookup) thanh 1 bang phang,
-- doc + ghi xuyen qua entity_records cua cac entity nguon. Khong co bang
-- du lieu rieng. Mirror cau truc bang entities.

CREATE TABLE IF NOT EXISTS datasources (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  label text NOT NULL,
  icon text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Unique ten case-insensitive trong cong ty (chong trung "Order" vs "order").
CREATE UNIQUE INDEX IF NOT EXISTS datasources_company_name_idx
  ON datasources (company_id, lower(name));

CREATE INDEX IF NOT EXISTS datasources_company_idx
  ON datasources (company_id);
