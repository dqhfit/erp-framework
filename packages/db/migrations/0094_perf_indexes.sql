-- 0094_perf_indexes.sql -- Performance indexes (hot path).
--
-- 1. entity_records: index composite (company_id, entity_id):
--    - Partial (deleted_at IS NULL) cho query list/count active records (90%+ case).
--    - Full cho includeDeleted=true (restore UI, audit).
--    Index hien co: entity_records_entity_id_idx chi co entity_id (khong co company_id)
--    => full-scan theo company_id, chem toc do list tren DB nhieu tenant.
--
-- 2. notifications: index composite (user_id, company_id, read_at) --
--    ho tro unreadCount + list per-user; company_id scope cho query tuong lai
--    (multi-company user). Index hien co notifications_user_idx (user_id, read_at)
--    duoc giu nguyen de khong break plan cu; index moi phuc vu covering scan.
--
-- Tuy chon (CHUA THEM -- can profile truoc khi them):
-- Expression index tren entity_records.data JSONB cho cac field sort/filter hay dung
-- (vd data->>'maddh', data->>'maspdh'). Chi them sau khi xac dinh duoc field hot
-- bang EXPLAIN ANALYZE tren prod -- tranh tao index thua gay cham ghi.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS -- an toan re-run.

CREATE INDEX IF NOT EXISTS "er_company_entity_active_idx"
  ON "entity_records" (company_id, entity_id)
  WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "er_company_entity_idx"
  ON "entity_records" (company_id, entity_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "notifications_user_company_idx"
  ON "notifications" (user_id, company_id, read_at);
