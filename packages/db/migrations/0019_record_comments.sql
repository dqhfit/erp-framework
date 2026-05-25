/* 0019_record_comments.sql -- Comments per record + nested replies.
   parent_id NULL = top-level; non-null = reply toi comment khac. */

CREATE TABLE IF NOT EXISTS "record_comments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"parent_id" uuid,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "record_comments" ADD CONSTRAINT "record_comments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "record_comments" ADD CONSTRAINT "record_comments_record_id_entity_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."entity_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "record_comments" ADD CONSTRAINT "record_comments_parent_id_record_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."record_comments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "record_comments" ADD CONSTRAINT "record_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_comments_record_idx" ON "record_comments" ("record_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_comments_parent_idx" ON "record_comments" ("parent_id");
