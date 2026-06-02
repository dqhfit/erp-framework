-- 0065_nav_items.sql
-- Bang nav_items: cau hinh menu/dieu huong per-company dang CAY. Admin dung
-- trinh dung menu de tu sap xep page/link thanh nhom (vd tai cau truc menu
-- DQHF sau khi port). Render o Sidebar.
--
-- parentId self-ref voi ON DELETE CASCADE (xoa nhom -> xoa con).
-- Idempotent: CREATE TABLE IF NOT EXISTS + FK trong DO block bat duplicate.

CREATE TABLE IF NOT EXISTS nav_items (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  parent_id   uuid,
  kind        text NOT NULL DEFAULT 'group',
  label       text NOT NULL,
  icon        text,
  target      text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE nav_items
    ADD CONSTRAINT nav_items_parent_fk
    FOREIGN KEY (parent_id) REFERENCES nav_items(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS nav_items_company_idx ON nav_items (company_id);
CREATE INDEX IF NOT EXISTS nav_items_parent_idx ON nav_items (parent_id);
