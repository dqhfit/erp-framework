-- 0064_full_job_reconcile.sql
-- Them cot reconciliation vao migration_full_job_tables: sau full-import, so
-- COUNT(*) nguon MSSQL (src_count) vs count entity_records dich (tgt_count).
-- reconcile: null=chua check | 'ok'=khop | 'drift'=lech | 'skip'=khong check.
-- Drift chan job hoan thanh (coi nhu chua xong) -> bat loi mat du lieu am tham.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE migration_full_job_tables
  ADD COLUMN IF NOT EXISTS src_count bigint,
  ADD COLUMN IF NOT EXISTS tgt_count bigint,
  ADD COLUMN IF NOT EXISTS reconcile text;
