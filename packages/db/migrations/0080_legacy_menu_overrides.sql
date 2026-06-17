-- 0080: legacy_menu_map - lop override cau truc + node tu them (custom).
-- overrides (jsonb): giu chinh tay cau truc menu DQHF (name / parentCode / sort
--   / active). Re-import tu SYS_MENU_NEW ghi de cot raw, sau do re-apply tu
--   overrides nen chinh tay khong bi mat (xem reapplyMenuOverrides).
-- custom (bool): node nguoi dung tu them trong app, KHONG co trong SYS_MENU_NEW
--   nen import khong dung toi (source_code rieng) - song sot qua moi lan import.
ALTER TABLE legacy_menu_map ADD COLUMN IF NOT EXISTS overrides jsonb;
ALTER TABLE legacy_menu_map ADD COLUMN IF NOT EXISTS custom boolean NOT NULL DEFAULT false;
