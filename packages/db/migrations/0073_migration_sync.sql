-- 0073_migration_sync.sql
-- Sync state cho delta-sync MSSQL->PG (chay song song + cutover tung module).
-- migration_sync_tables: per-bang config + CT watermark + counters
-- migration_sync_modules: per-module cron config + heartbeat lock chong chong lan
-- migration_sync_runs: lich su chu ky (debug + chart lag)
-- Idempotent: CREATE TABLE IF NOT EXISTS + DO...EXCEPTION cho constraint.

CREATE TABLE IF NOT EXISTS migration_sync_tables (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES mssql_connections(id) ON DELETE CASCADE,
  module text NOT NULL,
  table_name text NOT NULL,
  entity_id uuid REFERENCES entities(id) ON DELETE SET NULL,
  pk_column text,
  -- mode: ct=Change Tracking chinh, rescan=quet lai toan bo (fallback dem), manual=khong tu dong
  mode text NOT NULL DEFAULT 'ct',
  enabled boolean NOT NULL DEFAULT true,
  -- status: idle|seeding|running|error|reseed_required|cutover
  status text NOT NULL DEFAULT 'idle',
  ct_last_version bigint,            -- watermark CT (SYS_CHANGE_VERSION da apply)
  src_current_version bigint,        -- version MSSQL hien tai (de tinh pending_changes)
  pending_changes integer,           -- uoc tinh so row chua sync
  inserts_count bigint NOT NULL DEFAULT 0,
  updates_count bigint NOT NULL DEFAULT 0,
  deletes_count bigint NOT NULL DEFAULT 0,
  last_synced_at timestamp,
  last_error text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE migration_sync_tables
    ADD CONSTRAINT migration_sync_tables_company_table_uq
    UNIQUE (company_id, connection_id, table_name);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS migration_sync_tables_company_module_idx
  ON migration_sync_tables (company_id, module);

CREATE TABLE IF NOT EXISTS migration_sync_modules (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES mssql_connections(id) ON DELETE CASCADE,
  module text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  cron_expr text NOT NULL DEFAULT '*/5 * * * *',
  -- heartbeat_at: NULL = khong co job dang chay; co gia tri = dang chay (lock)
  -- Stale sau 10 phut (process crash) -> cho phep job moi lay lock
  heartbeat_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE migration_sync_modules
    ADD CONSTRAINT migration_sync_modules_company_module_uq
    UNIQUE (company_id, connection_id, module);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS migration_sync_runs (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES mssql_connections(id) ON DELETE CASCADE,
  module text NOT NULL,
  table_name text,
  started_at timestamp NOT NULL DEFAULT now(),
  finished_at timestamp,
  duration_ms integer,
  inserts integer NOT NULL DEFAULT 0,
  updates integer NOT NULL DEFAULT 0,
  deletes integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS migration_sync_runs_company_module_idx
  ON migration_sync_runs (company_id, module, started_at DESC);
