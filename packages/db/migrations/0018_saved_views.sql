/* 0018_saved_views.sql -- Saved views per entity per user.
   Moi view luu query (filter/sort/q) + columns config; user mo view
   nao thi ap dung -- KHONG phai re-filter moi lan. is_default = mac
   dinh mo entity se load view nay. */

CREATE TABLE IF NOT EXISTS "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_by" uuid,
	"name" text NOT NULL,
	"query" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"columns" jsonb,
	"is_default" boolean NOT NULL DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_views_entity_idx" ON "saved_views" ("entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_views_user_entity_idx" ON "saved_views" ("created_by", "entity_id");
