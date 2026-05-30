-- 0054_procedures_source_meta.sql
-- Them cot meta (jsonb) cho bang procedures de luu nguon goc khi migrate
-- tu stored procedure MSSQL. meta.source = { kind, sourceProc, module,
-- tier, migratedAt, migratedBy } -> truy nguoc proc moi ve proc MSSQL cu
-- (doi xung voi entities.meta.source).
-- Idempotent: ADD COLUMN IF NOT EXISTS, an toan re-run khi DB drift.

ALTER TABLE procedures
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;
