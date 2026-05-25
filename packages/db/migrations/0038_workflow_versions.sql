/* 0036_workflow_versions.sql -- Workflow versioning + A/B testing.
   Moi publish snapshot graph vao row moi; nhieu version active song
   song voi weight % cho A/B test. weight=100 = chi chay version nay;
   weight=50 + version khac weight=50 = split 50/50. */

CREATE TABLE IF NOT EXISTS "workflow_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"label" text NOT NULL DEFAULT 'v1',
	"graph" jsonb NOT NULL,
	"weight" integer NOT NULL DEFAULT 100,
	"active" boolean NOT NULL DEFAULT true,
	"published_by" uuid,
	"published_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_versions" ADD CONSTRAINT "wv_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_versions" ADD CONSTRAINT "wv_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_versions" ADD CONSTRAINT "wv_published_by_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wv_workflow_version_idx" ON "workflow_versions" ("workflow_id", "version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wv_workflow_active_idx" ON "workflow_versions" ("workflow_id", "active");
