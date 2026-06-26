-- Reverse replica 1 chieu ERP(PG) -> MSSQL (read-only phia MSSQL).
-- Sau cutover, day thay doi cua module nguoc ve MSSQL de DQHF/report cu doc.
-- Mirror nguoc cua delta-sync: watermark keyset (updated_at, id) thay vi CT version.
-- Idempotent: an toan re-run khi DB drift.

CREATE TABLE IF NOT EXISTS migration_reverse_sync (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id        uuid NOT NULL,
  connection_id     uuid NOT NULL,
  module            text NOT NULL,
  entity_id         uuid,
  mssql_table       text NOT NULL,
  pk_field          text NOT NULL,
  -- Watermark tuple: row cuoi da day (keyset updated_at, id).
  wm_updated_at     timestamptz,
  wm_id             uuid,
  lag_seconds       integer NOT NULL DEFAULT 5,
  -- delete_mode: hard (DELETE that) | soft (set cot co)
  delete_mode       text NOT NULL DEFAULT 'hard',
  soft_delete_col   text,
  identity_insert   boolean NOT NULL DEFAULT true,
  enabled           boolean NOT NULL DEFAULT false,
  -- status: idle | seeding | running | error | paused
  status            text NOT NULL DEFAULT 'idle',
  upserts_count     bigint NOT NULL DEFAULT 0,
  deletes_count     bigint NOT NULL DEFAULT 0,
  last_synced_at    timestamptz,
  last_error        text,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE migration_reverse_sync
    ADD CONSTRAINT migration_reverse_sync_company_fk
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE migration_reverse_sync
    ADD CONSTRAINT migration_reverse_sync_conn_fk
    FOREIGN KEY (connection_id) REFERENCES mssql_connections(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE migration_reverse_sync
    ADD CONSTRAINT migration_reverse_sync_entity_fk
    FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE migration_reverse_sync
    ADD CONSTRAINT migration_reverse_sync_created_by_fk
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS migration_reverse_sync_conn_table_uq_idx
  ON migration_reverse_sync (company_id, connection_id, mssql_table);
CREATE INDEX IF NOT EXISTS migration_reverse_sync_company_module_idx
  ON migration_reverse_sync (company_id, module);

CREATE TABLE IF NOT EXISTS migration_reverse_modules (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id     uuid NOT NULL,
  connection_id  uuid NOT NULL,
  module         text NOT NULL,
  enabled        boolean NOT NULL DEFAULT false,
  cron_expr      text NOT NULL DEFAULT '*/5 * * * *',
  created_by     uuid,
  heartbeat_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE migration_reverse_modules
    ADD CONSTRAINT migration_reverse_modules_company_fk
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE migration_reverse_modules
    ADD CONSTRAINT migration_reverse_modules_conn_fk
    FOREIGN KEY (connection_id) REFERENCES mssql_connections(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE migration_reverse_modules
    ADD CONSTRAINT migration_reverse_modules_created_by_fk
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS migration_reverse_modules_company_module_uq_idx
  ON migration_reverse_modules (company_id, connection_id, module);

-- Tai dung bang runs cho ca 2 chieu: direction = forward (mac dinh) | reverse.
ALTER TABLE migration_sync_runs ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'forward';
