/* 0037_compliance_theming.sql -- Per-tenant theming + audit report metadata.
   - companies.theme JSONB: { primaryColor, logoUrl, productName, faviconUrl }.
   - audit_reports tracking: ai/khi nao export bao cao (immutable evidence). */

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "theme" jsonb;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "audit_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_date" timestamp,
	"to_date" timestamp,
	"row_count" integer,
	"requested_by" uuid,
	"requested_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_reports" ADD CONSTRAINT "ar_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_reports" ADD CONSTRAINT "ar_requested_by_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
