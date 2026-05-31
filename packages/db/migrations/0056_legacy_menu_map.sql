-- 0056_legacy_menu_map.sql
-- Bang legacy_menu_map: ban do menu app cu DQHF (bang SYS_MENU_NEW) import vao
-- de port dan theo menu (cockpit menu-driven). Moi row = 1 node menu legacy:
-- ma (source_code/C_MENU), ten (N_MENU), cap (level/C_LEVEL), cha (parent_code/
-- C_MENU_UPPER), form (win_id/C_WIN_ID) + namespace, cong them port_status
-- (chua|dang|xong) va page_id (page moi sau khi port).
-- Re-import chi cap nhat metadata, GIU port_status/module/page_id.
-- Idempotent: CREATE TABLE IF NOT EXISTS + index IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS legacy_menu_map (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_id integer NOT NULL,
  source_code text NOT NULL,
  name text,
  level integer,
  parent_code text,
  sort integer NOT NULL DEFAULT 0,
  win_id text,
  namespace text,
  system text,
  is_show_dialog boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  port_status text NOT NULL DEFAULT 'chua',
  module text,
  page_id uuid REFERENCES pages(id) ON DELETE SET NULL,
  imported_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS legacy_menu_map_company_code_idx
  ON legacy_menu_map (company_id, source_code);

CREATE INDEX IF NOT EXISTS legacy_menu_map_company_parent_idx
  ON legacy_menu_map (company_id, parent_code);
