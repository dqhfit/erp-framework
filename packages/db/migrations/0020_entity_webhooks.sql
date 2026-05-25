/* 0020_entity_webhooks.sql — Outgoing webhooks per entity (record events).
   Server fire-and-forget HTTP POST khi events khớp với create/update/delete.
   secret_hash dùng HMAC-SHA256 ký body, gửi qua header X-ERP-Signature.
   Đơn giản hơn workflow webhook trigger (không cần thiết kế graph). */

CREATE TABLE IF NOT EXISTS "entity_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"events" jsonb NOT NULL DEFAULT '["create","update","delete"]'::jsonb,
	"headers" jsonb,
	"secret" text,
	"enabled" boolean NOT NULL DEFAULT true,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_fired_at" timestamp,
	"last_status" integer
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_webhooks" ADD CONSTRAINT "entity_webhooks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_webhooks" ADD CONSTRAINT "entity_webhooks_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_webhooks" ADD CONSTRAINT "entity_webhooks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_webhooks_entity_idx" ON "entity_webhooks" ("entity_id");
