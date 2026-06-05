-- 0069_feedback_ai_proposals.sql
-- Lo trinh nang cap (roadmap_items) + de xuat AI cho preview (ai_proposals).
-- MCP server cho phep AI doc feedback va GHI de xuat o trang thai pending.
-- AI KHONG mutate truc tiep: admin duyet trong UI -> applyProposalActions
-- moi thuc thi (doi status / danh dau trung / them vao lo trinh).
-- ai_proposals.actions: mang hanh dong dang JSON
--   set_status     { feedbackIds, status, resolutionNote? }
--   mark_duplicate { primaryId, duplicateIds, status?, resolutionNote? }
--   add_to_roadmap { feedbackIds, roadmapId? , roadmap?{title,...}, setStatus? }

-- ===== roadmap_items: lo trinh / task-fix that =====
CREATE TABLE IF NOT EXISTS "roadmap_items" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "company_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "area" text,
  "status" text DEFAULT 'planned' NOT NULL,      -- planned|in_progress|done|dropped
  "priority" text DEFAULT 'normal' NOT NULL,     -- low|normal|high
  "target_quarter" text,                         -- vd 2026-Q3
  "feedback_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "source" text DEFAULT 'manual' NOT NULL,       -- manual|ai_proposal
  "created_by" uuid,                             -- null = AI/he thong
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "roadmap_items" ADD CONSTRAINT "roadmap_items_company_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "roadmap_items" ADD CONSTRAINT "roadmap_items_created_by_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "roadmap_items_company_status_idx"
  ON "roadmap_items" ("company_id", "status");

-- ===== ai_proposals: de xuat AI cho preview/duyet =====
CREATE TABLE IF NOT EXISTS "ai_proposals" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "company_id" uuid NOT NULL,
  "title" text NOT NULL,
  "summary" text,                                -- markdown AI viet (noi dung preview)
  "actions" jsonb DEFAULT '[]'::jsonb NOT NULL,  -- mang hanh dong de xuat
  "feedback_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,      -- pending|approved|rejected|applied|superseded
  "created_by_kind" text DEFAULT 'ai' NOT NULL,  -- ai|user
  "created_by" uuid,
  "api_key_id" uuid,                             -- key MCP da tao (audit)
  "review_note" text,
  "reviewed_by" uuid,
  "reviewed_at" timestamp,
  "applied_at" timestamp,
  "apply_result" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_company_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_created_by_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_api_key_id_fk"
    FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_reviewed_by_fk"
    FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "ai_proposals_company_status_idx"
  ON "ai_proposals" ("company_id", "status");
