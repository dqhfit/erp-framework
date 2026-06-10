-- 0074_migration_sync_created_by.sql
-- Them cot created_by (uuid user bat sync) vao migration_sync_modules.
-- Ly do: cron tick can userId THAT lam created_by khi delta-sync insert row
-- moi (truoc day truyen chuoi 'system' -> vo cast ::uuid o insertRowToTable).
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE migration_sync_modules
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
