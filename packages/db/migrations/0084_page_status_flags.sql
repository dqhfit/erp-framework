-- 0084: co (flag) trang thai cho trang.
-- pages.status: khoa co dang gan cho trang. Gia tri = key co built-in
--   (new/in_progress/review/done/published/archived) HOAC id (uuid) cua co
--   tuy chinh trong page_flags. null = chua gan co.
-- page_flags: co TUY CHINH per-company ("co cua toi") — nguoi dung tu them
--   ngoai bo co built-in. color = ten token semantic
--   (accent/accent-2/success/warning/danger/neutral), KHONG hardcode hex.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS status text;

CREATE TABLE IF NOT EXISTS page_flags (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  label text NOT NULL,
  color text NOT NULL DEFAULT 'accent',
  icon text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS page_flags_company_idx ON page_flags (company_id);
