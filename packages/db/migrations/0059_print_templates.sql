-- 0059_print_templates.sql
-- Bang print_templates: template HTML cho engine in PDF. Render = template +
-- data (rows tu data_procedure) -> HTML in-ready; xuat PDF qua trinh duyet
-- (mac dinh) hoac Puppeteer (neu cai Chromium). Idempotent.

CREATE TABLE IF NOT EXISTS print_templates (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  label text NOT NULL,
  report_class text,
  data_procedure text,
  html text NOT NULL DEFAULT '',
  page_size text NOT NULL DEFAULT 'A4',
  orientation text NOT NULL DEFAULT 'portrait',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS print_templates_company_name_idx
  ON print_templates (company_id, name);
