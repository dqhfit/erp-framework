-- 0055_migration_jobs.sql
-- Bang migration_jobs: luu state durable cho action job (discover/enrich/
-- generate/data) chay qua pg-boss queue "migration-run". Truoc day state
-- chi nam in-memory -> mat khi restart va khong resume duoc. Bang nay cho
-- phep: song sot restart (pg-boss giao lai job, worker doc row) + resume
-- khi loi (re-enqueue cung args). full-import dung bang rieng, khong dung day.
-- Idempotent: CREATE TABLE IF NOT EXISTS + index IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS migration_jobs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  module text NOT NULL,
  args jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  message text,
  error text,
  started_at timestamp,
  completed_at timestamp,
  duration_ms integer,
  last_heartbeat timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS migration_jobs_company_status_idx
  ON migration_jobs (company_id, status);
