-- Lease chong 2 worker chay cung full-import job (rolling deploy overlap):
-- worker claim job bang token moi, heartbeat per-batch co dieu kien
-- worker_token = token cua minh -> worker cu mat lease tu dung ngay.
ALTER TABLE migration_full_jobs ADD COLUMN IF NOT EXISTS worker_token uuid;
