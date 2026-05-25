/* 0031_feedback.sql -- Feedback system: user bao bat cap + de xuat.
   feedbacks: title/body/suggestion + area + status pipeline + AI fields.
   feedback_votes: upvote idempotent PK (feedback_id, user_id).
   feedback_comments: comments thread rieng (record_comments FK vao
   entity_records khong tro feedback duoc).
   Pattern IF NOT EXISTS de an toan khi journal-DB lech nhau. */

DO $$ BEGIN
 CREATE TYPE "feedback_status" AS ENUM ('new', 'in_progress', 'done', 'wontfix');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "feedback_severity" AS ENUM ('nice_to_have', 'normal', 'blocker');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feedbacks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"suggestion" text,
	"area" text NOT NULL,
	"url" text,
	"entity_ref" jsonb,
	"severity" "feedback_severity" DEFAULT 'normal' NOT NULL,
	"status" "feedback_status" DEFAULT 'new' NOT NULL,
	"resolution_note" text,
	"ai_summary" text,
	"ai_tags" jsonb,
	"embedding" vector(768),
	"vote_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_author_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedbacks_company_status_idx" ON "feedbacks" ("company_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedbacks_company_area_idx" ON "feedbacks" ("company_id", "area");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedbacks_author_idx" ON "feedbacks" ("author_user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feedback_votes" (
	"feedback_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_votes_pkey" PRIMARY KEY ("feedback_id", "user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feedback_votes" ADD CONSTRAINT "feedback_votes_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedbacks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feedback_votes" ADD CONSTRAINT "feedback_votes_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feedback_comments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"feedback_id" uuid NOT NULL,
	"parent_id" uuid,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feedback_comments" ADD CONSTRAINT "feedback_comments_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feedback_comments" ADD CONSTRAINT "feedback_comments_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedbacks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feedback_comments" ADD CONSTRAINT "feedback_comments_author_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_comments_feedback_idx" ON "feedback_comments" ("feedback_id");
