/* 0030_oauth_tokens.sql -- OAuth 2.0 refresh tokens + PKCE auth codes.
   refresh_tokens: long-lived, rotate khi dung (issue new + revoke cu).
   auth_codes: short-lived (10 phut), PKCE code_challenge + verifier. */

CREATE TABLE IF NOT EXISTS "oauth_refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"api_key_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "ort_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "ort_api_key_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ort_token_hash_idx" ON "oauth_refresh_tokens" ("token_hash");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "oauth_auth_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code_hash" text NOT NULL,
	"client_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"api_key_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"code_challenge_method" text NOT NULL DEFAULT 'S256',
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_auth_codes" ADD CONSTRAINT "oac_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_auth_codes" ADD CONSTRAINT "oac_api_key_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "oac_code_hash_idx" ON "oauth_auth_codes" ("code_hash");
