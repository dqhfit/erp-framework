-- 0058_legacy_reports.sql
-- Bang legacy_reports: blueprint bao cao XtraReports (class rpt_*) trich tu
-- source C# DQHF — tieu de + data proc + cot (header) + group + summary. Dung
-- de dung lai report dang bang (list page) hoac lam spec cho template in.
-- Idempotent: CREATE TABLE IF NOT EXISTS + index IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS legacy_reports (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  report_class text NOT NULL,
  namespace text,
  title text,
  kind text NOT NULL DEFAULT 'table',
  data_procs jsonb NOT NULL DEFAULT '[]'::jsonb,
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  groups jsonb NOT NULL DEFAULT '[]'::jsonb,
  summaries jsonb NOT NULL DEFAULT '[]'::jsonb,
  has_before_print integer NOT NULL DEFAULT 0,
  page_id uuid REFERENCES pages(id) ON DELETE SET NULL,
  parsed_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS legacy_reports_company_class_idx
  ON legacy_reports (company_id, report_class);
