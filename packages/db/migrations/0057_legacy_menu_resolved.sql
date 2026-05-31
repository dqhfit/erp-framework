-- 0057_legacy_menu_resolved.sql
-- Them cot resolved (jsonb) + resolved_at vao legacy_menu_map: ket qua resolver
-- menu node -> form .cs -> {procs, controls, repos, tables}. Resolver doc source
-- C# DQHF (host fs) roi luu lai de cockpit dung lam seed cho discover khi port.
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE legacy_menu_map ADD COLUMN IF NOT EXISTS resolved jsonb;
ALTER TABLE legacy_menu_map ADD COLUMN IF NOT EXISTS resolved_at timestamp;
