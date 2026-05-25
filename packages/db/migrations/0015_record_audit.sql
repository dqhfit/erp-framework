/* 0015_record_audit.sql — Audit & Lifecycle cho entity_records.
   - deleted_at: soft delete; restore khả thi.
   - version: optimistic lock counter (tăng mỗi update).
   - entity_record_versions: lưu nguyên snapshot + diff per-field
     (cũ → mới) mỗi lần update. Đủ cho audit + revert. */

ALTER TABLE "entity_records" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
--> statement-breakpoint
ALTER TABLE "entity_records" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_records_deleted_at_idx" ON "entity_records" ("deleted_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "entity_record_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"data" jsonb NOT NULL,
	"diff" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"actor_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_record_versions" ADD CONSTRAINT "entity_record_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_record_versions" ADD CONSTRAINT "entity_record_versions_record_id_entity_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."entity_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_record_versions" ADD CONSTRAINT "entity_record_versions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_record_versions_record_id_idx" ON "entity_record_versions" ("record_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_record_versions_record_version_idx" ON "entity_record_versions" ("record_id", "version");
