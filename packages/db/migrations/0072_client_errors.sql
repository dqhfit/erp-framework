-- 0072_client_errors.sql
-- Loi phia client (client_errors). App tu gui loi runtime (window.onerror,
-- unhandledrejection, React ErrorBoundary) ve server qua tRPC errors.report.
-- Gom trung theo fingerprint (server tinh tu message + frame stack dau):
-- cung 1 loi lap lai chi tang count + last_seen, KHONG de dong moi.
-- Admin theo doi o /settings/errors. MCP server (mcp-errors.ts) cho AI
-- doc + doi trang thai / xoa loi (scope errors:read|write).

CREATE TABLE IF NOT EXISTS "client_errors" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "company_id" uuid NOT NULL,
  "user_id" uuid,                                  -- user gap loi (set null khi xoa user)
  "fingerprint" text NOT NULL,                     -- khoa gom trung (server tinh)
  "level" text DEFAULT 'error' NOT NULL,           -- error|warn
  "source" text DEFAULT 'unknown' NOT NULL,        -- window.onerror|unhandledrejection|react|manual
  "message" text NOT NULL,
  "stack" text,
  "component_stack" text,                          -- React error boundary
  "url" text,                                      -- URL trang luc loi
  "user_agent" text,
  "meta" jsonb,                                    -- ngu canh them
  "status" text DEFAULT 'open' NOT NULL,           -- open|resolved|ignored
  "count" integer DEFAULT 1 NOT NULL,              -- so lan lap (gom trung)
  "first_seen_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "client_errors" ADD CONSTRAINT "client_errors_company_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "client_errors" ADD CONSTRAINT "client_errors_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Gom trung: 1 fingerprint / cong ty -> ON CONFLICT DO UPDATE tang count.
CREATE UNIQUE INDEX IF NOT EXISTS "client_errors_company_fingerprint_uniq"
  ON "client_errors" ("company_id", "fingerprint");

CREATE INDEX IF NOT EXISTS "client_errors_company_status_seen_idx"
  ON "client_errors" ("company_id", "status", "last_seen_at");
