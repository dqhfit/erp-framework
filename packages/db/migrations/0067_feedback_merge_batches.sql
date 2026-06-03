-- 0067_feedback_merge_batches.sql
-- Dot gop feedback: admin danh dau 1 lan gop de doi trang thai hang loat sau.
-- feedback_ids la snapshot id luc luu; muc bi xoa se bo qua khi ap dung.

CREATE TABLE IF NOT EXISTS "feedback_merge_batches" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "company_id" uuid NOT NULL,
  "created_by" uuid,
  "label" text NOT NULL,
  "note" text,
  "filter_snapshot" jsonb,
  "feedback_ids" jsonb NOT NULL,
  "item_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "feedback_merge_batches" ADD CONSTRAINT "feedback_merge_batches_company_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "feedback_merge_batches" ADD CONSTRAINT "feedback_merge_batches_created_by_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "feedback_merge_batches_company_created_idx"
  ON "feedback_merge_batches" ("company_id", "created_at");
