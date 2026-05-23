/* 0010_backup.sql — Backup lên Google Drive qua UI/cron.
   Mỗi công ty cấu hình riêng (service account key được mã hoá ở
   app layer trước khi lưu — xem crypto.ts). Upload đi 2 đường:
   - DB: pg_dump custom-format → 1 file mới mỗi lần backup.
   - Files: thư mục /data/uploads sync 1-1 vào folder con uploads/
     trong Drive (incremental — không re-upload file đã có/không đổi).
   `upload_sync_state` cache (path, size, mtime, drive_file_id) để
   tránh quét lại Drive mỗi lần. */

CREATE TABLE IF NOT EXISTS "backup_config" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  /* JSON service account key đã mã hoá AES-256-GCM (xem crypto.ts). */
  "gdrive_key_enc" text NOT NULL,
  /* ID thư mục Drive đã share quyền Editor cho service account. */
  "gdrive_folder_id" text NOT NULL,
  /* Cron expr (5 trường). NULL = không tự động, chỉ chạy thủ công. */
  "schedule_cron" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "backup_config_company_uidx"
  ON "backup_config"("company_id");

CREATE TABLE IF NOT EXISTS "backup_runs" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'running',  -- running | done | error
  "trigger" text NOT NULL DEFAULT 'manual',  -- manual | cron
  "db_drive_file_id" text,
  "db_bytes" bigint,
  "uploads_synced" integer NOT NULL DEFAULT 0,
  "uploads_skipped" integer NOT NULL DEFAULT 0,
  "uploads_bytes" bigint NOT NULL DEFAULT 0,
  "error" text,
  "started_at" timestamp NOT NULL DEFAULT now(),
  "finished_at" timestamp
);
CREATE INDEX IF NOT EXISTS "backup_runs_company_started_idx"
  ON "backup_runs"("company_id", "started_at" DESC);

/* Cache mapping file local → file ở Drive. Lookup nhanh khi sync —
   không cần list Drive mỗi lần để dò file đã upload. */
CREATE TABLE IF NOT EXISTS "upload_sync_state" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  /* Đường dẫn tương đối trong /data/uploads (vd "company-uuid/foo.pdf"). */
  "rel_path" text NOT NULL,
  "drive_file_id" text NOT NULL,
  "size" bigint NOT NULL,
  /* mtime của file lúc upload — đổi → re-upload. */
  "mtime" timestamp NOT NULL,
  "synced_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "upload_sync_state_company_path_uidx"
  ON "upload_sync_state"("company_id", "rel_path");
