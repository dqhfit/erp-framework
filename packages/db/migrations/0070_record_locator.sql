-- 0070_record_locator.sql
-- Locator record->entity for HYBRID storage (Phase 1). Holds ONLY records of
-- tier='table' entities (those live in er_<entityId>, not entity_records).
-- Lets recordId-only ops (get/update/delete) route to the right table.
-- Empty/unused until ERP_HYBRID_TABLES=1 + an entity is promoted to a table.

CREATE TABLE IF NOT EXISTS record_locator (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  entity_id uuid NOT NULL
);

DO $$ BEGIN
  ALTER TABLE record_locator ADD CONSTRAINT record_locator_company_fk
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE record_locator ADD CONSTRAINT record_locator_entity_fk
    FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS record_locator_company_idx ON record_locator (company_id);
