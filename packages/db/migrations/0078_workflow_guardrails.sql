-- 0078_workflow_guardrails.sql
-- Guardrails: bai hoc tu node fail lap lai (Loops!-style).
-- Khi mot node trong workflow fail lap cung loi (gom theo fingerprint),
-- ghi nhan + dem fail_count; cham nguong -> sinh "lesson" (LLM, fail-safe)
-- de tu chen vao system prompt cac lan chay sau, tranh lap loi. Tuong tu
-- .ralph/guardrails.md nhung multi-tenant, gan theo workflow + node.

CREATE TABLE IF NOT EXISTS "workflow_guardrails" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "company_id" uuid NOT NULL,
  "workflow_id" uuid NOT NULL,
  "node_id" text NOT NULL,                          -- id node trong graph gap loi
  "fingerprint" text NOT NULL,                      -- khoa gom trung (server tinh tu message)
  "error_sample" text NOT NULL,                     -- thong diep loi goc (cat ngan)
  "fail_count" integer DEFAULT 1 NOT NULL,          -- so lan lap (gom trung)
  "lesson" text,                                    -- bai hoc chen vao prompt; null = chua co
  "status" text DEFAULT 'active' NOT NULL,          -- active|archived
  "first_seen_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  "threshold_met_at" timestamp,                     -- luc cham nguong (>= THRESHOLD)
  "updated_by" uuid,                                -- ai sua lesson (set null khi xoa user)
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "workflow_guardrails" ADD CONSTRAINT "workflow_guardrails_company_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "workflow_guardrails" ADD CONSTRAINT "workflow_guardrails_workflow_id_fk"
    FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "workflow_guardrails" ADD CONSTRAINT "workflow_guardrails_updated_by_fk"
    FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Gom trung: 1 (cong ty, workflow, node, fingerprint) -> ON CONFLICT DO UPDATE tang fail_count.
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_guardrails_uk"
  ON "workflow_guardrails" ("company_id", "workflow_id", "node_id", "fingerprint");

-- Liet ke guardrail dang active theo workflow.
CREATE INDEX IF NOT EXISTS "workflow_guardrails_list_idx"
  ON "workflow_guardrails" ("company_id", "workflow_id", "status");
