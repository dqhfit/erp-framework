/* 0035_encryption_keys.sql -- Encryption key rotation registry.
   active = true cho key dung de encrypt moi; decrypt thu moi key
   (theo created_at DESC) de support data da encrypt voi key cu.
   key_material chi bo phan cho dev -- production lay tu KMS / vault. */

CREATE TABLE IF NOT EXISTS "encryption_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kid" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_material" text,
	"active" boolean NOT NULL DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"rotated_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "encryption_keys_kid_idx" ON "encryption_keys" ("kid");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "encryption_keys_active_idx" ON "encryption_keys" ("active") WHERE active = true;
