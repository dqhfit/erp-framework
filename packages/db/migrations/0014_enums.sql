/* 0014_enums.sql — Reusable enum (option set) per company, đa ngôn ngữ.
   values JSONB: Array<{ value: string, label: string, labelEn?: string }>.
   Field type "enum"/"multi-enum" tham chiếu qua enum_id. */

CREATE TABLE IF NOT EXISTS "enums" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"label_en" text,
	"description" text,
	"values" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enums" ADD CONSTRAINT "enums_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enums" ADD CONSTRAINT "enums_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "enums_company_name_idx" ON "enums" USING btree ("company_id","name");
