/* 0017_field_governance.sql -- Field-level governance.
   - entity_sequences: counter atomic cho field type "sequence" (vd
     INV-001, INV-002...). Unique theo (company, entity_name, field_key).
     Server SELECT FOR UPDATE + INCREMENT trong transaction.
   - Field-level RBAC, unique constraint, sequence config duoc luu
     trong entities.fields[] (JSONB), khong can migration cot moi. */

CREATE TABLE IF NOT EXISTS "entity_sequences" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"entity_name" text NOT NULL,
	"field_key" text NOT NULL,
	"next_value" integer NOT NULL DEFAULT 1,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_sequences" ADD CONSTRAINT "entity_sequences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entity_sequences_uidx" ON "entity_sequences" ("company_id", "entity_name", "field_key");
