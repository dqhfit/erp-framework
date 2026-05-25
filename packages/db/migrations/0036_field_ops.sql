/* 0034_field_ops.sql -- Real-time co-edit operations log.
   Moi op text tren 1 (record, field) luu theo seq tang dan. Server
   apply OT (operational transform) don gian: insert/delete tai pos.
   Khi 2 user edit cung luc, server xu ly tuan tu theo seq, khong
   conflict mien ops gui dung baseSeq.

   Sau N op, gop lai snapshot vao entity_records.data (debounce 5s
   sau im lang) de giu row chinh canonical. */

CREATE TABLE IF NOT EXISTS "record_field_ops" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	"seq" integer NOT NULL,
	"base_seq" integer NOT NULL,
	"op" text NOT NULL,
	"pos" integer NOT NULL,
	"chars" text,
	"length" integer,
	"actor_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "record_field_ops" ADD CONSTRAINT "rfo_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "record_field_ops" ADD CONSTRAINT "rfo_record_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."entity_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "record_field_ops" ADD CONSTRAINT "rfo_actor_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rfo_record_field_seq_idx" ON "record_field_ops" ("record_id", "field_name", "seq");
