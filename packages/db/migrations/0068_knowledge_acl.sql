-- 0068_knowledge_acl.sql
-- Phan quyen nguon tri thuc (knowledge_sources) theo user/nhom.
--
-- (a) Cot visibility: 'company' (mac dinh, tuong thich nguoc -> moi user co
--     quyen view:knowledge deu xem) | 'restricted' (chi admin + nguoi tao +
--     user/nhom duoc cap).
-- (b) Bang knowledge_source_viewer_groups: gan nguon -> nhom nguoi xem
--     (mirror page_viewer_groups). Cap rieng theo user dung resource_members
--     san co voi resource_type='knowledge'.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE TABLE IF NOT EXISTS.

ALTER TABLE knowledge_sources
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'company';

CREATE TABLE IF NOT EXISTS knowledge_source_viewer_groups (
  source_id uuid NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  group_id  uuid NOT NULL REFERENCES viewer_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (source_id, group_id)
);

CREATE INDEX IF NOT EXISTS knowledge_source_viewer_groups_group_idx
  ON knowledge_source_viewer_groups (group_id);
