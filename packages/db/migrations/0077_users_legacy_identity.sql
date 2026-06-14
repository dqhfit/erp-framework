-- Dinh danh LEGACY DQHF cho user duoc lazy-tao tu sys_user (bridge login MD5).
-- Bridge khop/ghi-de mat khau CHI cho user co cung (legacy_company_id,
-- legacy_username) -> KHONG bao gio dung user framework thuong (chong account
-- takeover qua va cham email tong hop username@dqhf.local). Unique partial
-- index dam bao 1 dinh danh legacy <-> 1 user framework.
ALTER TABLE users ADD COLUMN IF NOT EXISTS legacy_username text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS legacy_company_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS users_legacy_identity_uk
  ON users (legacy_company_id, lower(legacy_username))
  WHERE legacy_username IS NOT NULL;
