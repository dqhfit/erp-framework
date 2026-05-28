-- 0050_migration_full_jobs.sql -- Background full import jobs cho MSSQL
-- migration: ho tro stream + resume + sync re-run.
--
-- migration_full_jobs       : 1 job = 1 lan user bam "Full import".
-- migration_full_job_tables : per-table state, luu lastPk de resume.
--
-- Pattern idempotent: CREATE TABLE IF NOT EXISTS + DO block.

CREATE TABLE IF NOT EXISTS "migration_full_jobs" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "company_id" uuid NOT NULL,
  "connection_id" uuid NOT NULL,
  "kind" text DEFAULT 'full' NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "total_tables" integer DEFAULT 0 NOT NULL,
  "completed_tables" integer DEFAULT 0 NOT NULL,
  "total_rows_imported" bigint DEFAULT 0 NOT NULL,
  "started_at" timestamp,
  "completed_at" timestamp,
  "last_heartbeat" timestamp DEFAULT now() NOT NULL,
  "error" text,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "migration_full_job_tables" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "job_id" uuid NOT NULL,
  "table_name" text NOT NULL,
  "entity_id" uuid,
  "entity_name" text NOT NULL,
  "pk_column" text,
  "last_pk" text,
  "rows_imported" bigint DEFAULT 0 NOT NULL,
  "batch_size" integer DEFAULT 5000 NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "error" text,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "migration_full_jobs"
    ADD CONSTRAINT "migration_full_jobs_company_id_companies_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "migration_full_jobs"
    ADD CONSTRAINT "migration_full_jobs_connection_id_mssql_connections_id_fk"
    FOREIGN KEY ("connection_id") REFERENCES "public"."mssql_connections"("id")
    ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "migration_full_jobs"
    ADD CONSTRAINT "migration_full_jobs_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "migration_full_job_tables"
    ADD CONSTRAINT "migration_full_job_tables_job_id_migration_full_jobs_id_fk"
    FOREIGN KEY ("job_id") REFERENCES "public"."migration_full_jobs"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "migration_full_job_tables"
    ADD CONSTRAINT "migration_full_job_tables_entity_id_entities_id_fk"
    FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "migration_full_jobs_company_status_idx"
  ON "migration_full_jobs" USING btree ("company_id", "status");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "migration_full_job_tables_job_status_idx"
  ON "migration_full_job_tables" USING btree ("job_id", "status");
