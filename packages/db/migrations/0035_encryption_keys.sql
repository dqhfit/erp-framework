/* 0035_encryption_keys.sql — Encryption key rotation registry.
   active = true cho key dùng để encrypt mới; decrypt thử mọi key
   (theo created_at DESC) để support data đã encrypt với key cũ.
   key_material chỉ bộ phận cho dev — production lấy từ KMS / vault. */

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
