/* 0021_api_keys.sql — API key per company cho REST /api/v1/* endpoints.
   Key plaintext chỉ hiện 1 lần lúc tạo (sk_xxx); lưu hash để verify.
   scopes JSONB array vd ["entity:customer:read", "entity:order:write"].
   Empty scopes = full access (admin-equivalent). */

CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"label" text NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"scopes" jsonb NOT NULL DEFAULT '[]'::jsonb,
	"created_by" uuid,
	"last_used_at" timestamp,
	"enabled" boolean NOT NULL DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_hash_idx" ON "api_keys" ("key_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_company_idx" ON "api_keys" ("company_id");
