/* 0029_materialized_views.sql -- Custom materialized view per company.
   Pre-compute heavy aggregation (dashboard summary, monthly report)
   theo schedule cron; cache data JSONB. Cho phep dashboard load nhanh
   ma khong phai tinh lai moi lan. */

CREATE TABLE IF NOT EXISTS "entity_materialized_views" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"sql_query" text NOT NULL,
	"schedule_cron" text,
	"data" jsonb,
	"row_count" integer,
	"last_refreshed_at" timestamp,
	"last_error" text,
	"enabled" boolean NOT NULL DEFAULT true,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_materialized_views" ADD CONSTRAINT "emv_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_materialized_views" ADD CONSTRAINT "emv_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "emv_company_name_idx" ON "entity_materialized_views" ("company_id", "name");
--> statement-breakpoint

/* OAuth client_credentials cho api_keys -- client_id de identify ngoai
   key plaintext (cho dev UX), client_secret_hash cho rotation. */
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "client_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_client_id_idx" ON "api_keys" ("client_id") WHERE client_id IS NOT NULL;
