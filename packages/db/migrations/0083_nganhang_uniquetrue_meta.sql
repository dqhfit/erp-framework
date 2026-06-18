-- Đánh dấu field isdefault của entity ngân hàng là uniqueTrue:
-- meta.uniqueTrueFields = ["isdefault"] → server tự clear các record
-- khác khi 1 record được set isdefault = true.
UPDATE entities
SET meta = jsonb_set(
  coalesce(meta, '{}'::jsonb),
  '{uniqueTrueFields}',
  '["isdefault"]'::jsonb
)
WHERE id = 'db7914c0-3240-490b-ab5e-c721a3e91dd3';
