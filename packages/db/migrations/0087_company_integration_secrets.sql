-- Migration 0087: Luu secret tich hop ben thu ba per-company
-- Vi du: URL SearXNG (co the chua user:pass@) cho tinh nang web search.
-- provider phan biet loai tich hop (searxng, ...).
-- secret_enc = gia tri ma hoa AES-256-GCM qua crypto.ts.

CREATE TABLE IF NOT EXISTS company_integration_secrets (
  id            uuid        PRIMARY KEY DEFAULT uuidv7(),
  company_id    uuid        NOT NULL,
  provider      text        NOT NULL,
  secret_enc    text        NOT NULL,
  meta          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- FK company_id -> companies(id) ON DELETE CASCADE
DO $$ BEGIN
  ALTER TABLE company_integration_secrets
    ADD CONSTRAINT cis_company_id_fk
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- UNIQUE index tren (company_id, provider) -- moi cong ty chi co 1 row moi loai
CREATE UNIQUE INDEX IF NOT EXISTS cis_company_provider_uidx
  ON company_integration_secrets (company_id, provider);
