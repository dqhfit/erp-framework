/* 0023_entity_templates.sql — Templates print/email per entity.
   Mustache-like {{field}} substitution với record data. */

CREATE TABLE IF NOT EXISTS "entity_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"enabled" boolean NOT NULL DEFAULT true,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_templates" ADD CONSTRAINT "et_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_templates" ADD CONSTRAINT "et_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_templates" ADD CONSTRAINT "et_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "et_entity_idx" ON "entity_templates" ("entity_id", "kind");
