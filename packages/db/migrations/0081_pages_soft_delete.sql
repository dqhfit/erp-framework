-- 0081: xoa mem cho trang (pages).
-- deleted_at: null = active, timestamp = da xoa (con khoi phuc tu thung rac).
-- Read path (list/get/navTree/pageBindings) loc deleted_at IS NULL; purge moi
-- xoa cung that su.
-- Unique (company_id, name) doi sang PARTIAL (chi rang buoc trang active) de
-- trang da xoa mem khong chiem ten -> tao lai trung ten van duoc.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS deleted_at timestamp;

DROP INDEX IF EXISTS pages_company_name_idx;
CREATE UNIQUE INDEX IF NOT EXISTS pages_company_name_idx
  ON pages (company_id, name) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS pages_deleted_at_idx ON pages (deleted_at);
