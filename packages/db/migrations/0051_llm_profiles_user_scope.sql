-- Migration 0051: llm_profiles per-user scope + runtime
-- Them cot user_id (profile ca nhan, NULL = profile chung cong ty) va runtime
-- ("server" = server goi duoc, "browser" = model local tren may user). Doi
-- unique index company-name thanh partial (chi cho profile cong ty user_id IS
-- NULL), them partial unique cho profile ca nhan (company, user, name).

ALTER TABLE llm_profiles ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE llm_profiles ADD COLUMN IF NOT EXISTS runtime text NOT NULL DEFAULT 'server';

-- FK user_id -> users (cascade khi xoa user). Idempotent.
DO $$ BEGIN
  ALTER TABLE llm_profiles
    ADD CONSTRAINT llm_profiles_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Unique index cu (plain) -> partial: chi rang buoc profile cong ty.
DROP INDEX IF EXISTS llm_profiles_company_name_idx;
CREATE UNIQUE INDEX IF NOT EXISTS llm_profiles_company_name_idx
  ON llm_profiles (company_id, name) WHERE user_id IS NULL;

-- Unique cho profile ca nhan theo (company, user, name).
CREATE UNIQUE INDEX IF NOT EXISTS llm_profiles_company_user_name_idx
  ON llm_profiles (company_id, user_id, name) WHERE user_id IS NOT NULL;
