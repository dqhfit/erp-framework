/* 0025_record_presence.sql — Presence "đang xem" per record per user.
   UPSERT mỗi lần user mở record (ping). TTL implicit 30s qua filter
   server (WHERE last_seen > now() - interval '30 seconds'). */

CREATE TABLE IF NOT EXISTS "record_presence" (
	"record_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"last_seen" timestamp DEFAULT now() NOT NULL,
	PRIMARY KEY ("record_id", "user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "record_presence" ADD CONSTRAINT "rp_record_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."entity_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "record_presence" ADD CONSTRAINT "rp_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "record_presence" ADD CONSTRAINT "rp_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rp_last_seen_idx" ON "record_presence" ("last_seen");
