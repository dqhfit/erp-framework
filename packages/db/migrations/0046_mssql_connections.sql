-- 0046_mssql_connections.sql -- Connection MSSQL legacy per-company
-- de UI migration luu va dung. Password ma hoa bang crypto.ts
-- (AES-256-GCM, key tu ENCRYPTION_KEY).
--
-- Pattern giong llm_profiles + mcp_configs:
--   - company_id FK cascade
--   - unique (company_id, name)
--   - is_default: chi 1 row default per company (enforce o app layer)
--   - allow_write: cho phep execProc + INSERT/UPDATE/DELETE (mac dinh false)
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + DO block cho FK/index.

CREATE TABLE IF NOT EXISTS "mssql_connections" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "host" text NOT NULL,
  "port" integer DEFAULT 1433 NOT NULL,
  "database" text NOT NULL,
  "username" text NOT NULL,
  "password_enc" text DEFAULT '' NOT NULL,
  "encrypt" boolean DEFAULT true NOT NULL,
  "trust_server_cert" boolean DEFAULT false NOT NULL,
  "allow_write" boolean DEFAULT false NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "mssql_connections"
    ADD CONSTRAINT "mssql_connections_company_id_companies_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "mssql_connections"
    ADD CONSTRAINT "mssql_connections_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mssql_connections_company_name_idx"
  ON "mssql_connections" USING btree ("company_id", "name");
