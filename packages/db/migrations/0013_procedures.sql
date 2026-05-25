/* 0013_procedures.sql -- Native procedure registry.
   JS procedure dang ky runtime, chay server qua isolated-vm voi
   db/entity bindings. Thay dan stored proc MSSQL ben MCP. */

CREATE TABLE IF NOT EXISTS "procedures" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"params_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"return_schema" jsonb,
	"code" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "procedures" ADD CONSTRAINT "procedures_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "procedures" ADD CONSTRAINT "procedures_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "procedures_company_name_idx" ON "procedures" USING btree ("company_id","name");
