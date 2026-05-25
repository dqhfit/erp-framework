/* 0003_multi_tenant.sql -- Da cong ty (multi-tenant).
   Tao bang companies + company_members, gan company_id vao moi
   bang du lieu. Backfill: du lieu cu gan het vao "Cong ty mac dinh".
   Moi user hien co tro thanh thanh vien cong ty mac dinh, giu role cu. */

CREATE TABLE IF NOT EXISTS "companies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
INSERT INTO "companies" ("id", "name", "slug")
VALUES ('00000000-0000-0000-0000-000000000001', 'Cong ty mac dinh', 'default')
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_members" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_members" ADD CONSTRAINT "company_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_members" ADD CONSTRAINT "company_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_members_company_user_idx" ON "company_members" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_members_user_id_idx" ON "company_members" USING btree ("user_id");--> statement-breakpoint
INSERT INTO "company_members" ("company_id", "user_id", "role")
SELECT '00000000-0000-0000-0000-000000000001', "id", "role" FROM "users"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "active_company_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_company_id_companies_id_fk" FOREIGN KEY ("active_company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
UPDATE "sessions" SET "active_company_id" = '00000000-0000-0000-0000-000000000001' WHERE "active_company_id" IS NULL;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN IF NOT EXISTS "company_id" uuid;--> statement-breakpoint
ALTER TABLE "entity_records" ADD COLUMN IF NOT EXISTS "company_id" uuid;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "company_id" uuid;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS "company_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "company_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_configs" ADD COLUMN IF NOT EXISTS "company_id" uuid;--> statement-breakpoint
ALTER TABLE "llm_profiles" ADD COLUMN IF NOT EXISTS "company_id" uuid;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN IF NOT EXISTS "company_id" uuid;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "company_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN IF NOT EXISTS "company_id" uuid;--> statement-breakpoint
UPDATE "entities"      SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "entity_records" SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "pages"         SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "workflows"     SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "agents"        SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "mcp_configs"   SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "llm_profiles"  SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "activity_log"  SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "schedules"     SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
UPDATE "workflow_runs" SET "company_id" = '00000000-0000-0000-0000-000000000001' WHERE "company_id" IS NULL;--> statement-breakpoint
ALTER TABLE "entities"      ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_records" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pages"         ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows"     ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agents"        ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_configs"   ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_profiles"  ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_log"  ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "schedules"     ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_runs" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entities" ADD CONSTRAINT "entities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_records" ADD CONSTRAINT "entity_records_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pages" ADD CONSTRAINT "pages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflows" ADD CONSTRAINT "workflows_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents" ADD CONSTRAINT "agents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mcp_configs" ADD CONSTRAINT "mcp_configs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "llm_profiles" ADD CONSTRAINT "llm_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedules" ADD CONSTRAINT "schedules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
ALTER TABLE "entities" DROP CONSTRAINT IF EXISTS "entities_name_unique";--> statement-breakpoint
ALTER TABLE "pages" DROP CONSTRAINT IF EXISTS "pages_name_unique";--> statement-breakpoint
ALTER TABLE "mcp_configs" DROP CONSTRAINT IF EXISTS "mcp_configs_name_unique";--> statement-breakpoint
ALTER TABLE "llm_profiles" DROP CONSTRAINT IF EXISTS "llm_profiles_name_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entities_company_name_idx" ON "entities" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pages_company_name_idx" ON "pages" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_configs_company_name_idx" ON "mcp_configs" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "llm_profiles_company_name_idx" ON "llm_profiles" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_records_company_id_idx" ON "entity_records" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_company_id_idx" ON "workflows" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_company_id_idx" ON "agents" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_log_company_id_idx" ON "activity_log" USING btree ("company_id");
