/* 0006_entity_sync.sql -- Dong bo tu dong du lieu MCP -> entity_records.
   Bang moi, khong can backfill. Moi entity toi da 1 cau hinh sync
   (unique index tren entity_id). */

CREATE TABLE IF NOT EXISTS "entity_syncs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"cron_expr" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"pk_field" text DEFAULT '' NOT NULL,
	"last_run" timestamp,
	"last_status" "run_status",
	"last_summary" text,
	"run_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_syncs" ADD CONSTRAINT "entity_syncs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_syncs" ADD CONSTRAINT "entity_syncs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_syncs_company_id_idx" ON "entity_syncs" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entity_syncs_entity_id_idx" ON "entity_syncs" USING btree ("entity_id");
