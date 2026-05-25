/* 0010_backup.sql -- Backup len Google Drive qua UI/cron.
   Moi cong ty cau hinh rieng (service account key duoc ma hoa o
   app layer truoc khi luu -- xem crypto.ts). Upload di 2 duong:
   - DB: pg_dump custom-format -> 1 file moi moi lan backup.
   - Files: thu muc /data/uploads sync 1-1 vao folder con uploads/
     trong Drive (incremental -- khong re-upload file da co/khong doi).
   `upload_sync_state` cache (path, size, mtime, drive_file_id) de
   tranh quet lai Drive moi lan. */

CREATE TABLE IF NOT EXISTS "backup_config" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  /* JSON service account key da ma hoa AES-256-GCM (xem crypto.ts). */
  "gdrive_key_enc" text NOT NULL,
  /* ID thu muc Drive da share quyen Editor cho service account. */
  "gdrive_folder_id" text NOT NULL,
  /* Cron expr (5 truong). NULL = khong tu dong, chi chay thu cong. */
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

/* Cache mapping file local -> file o Drive. Lookup nhanh khi sync --
   khong can list Drive moi lan de do file da upload. */
CREATE TABLE IF NOT EXISTS "upload_sync_state" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  /* Duong dan tuong doi trong /data/uploads (vd "company-uuid/foo.pdf"). */
  "rel_path" text NOT NULL,
  "drive_file_id" text NOT NULL,
  "size" bigint NOT NULL,
  /* mtime cua file luc upload -- doi -> re-upload. */
  "mtime" timestamp NOT NULL,
  "synced_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "upload_sync_state_company_path_uidx"
  ON "upload_sync_state"("company_id", "rel_path");
