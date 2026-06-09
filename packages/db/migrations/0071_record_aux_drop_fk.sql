-- 0071_record_aux_drop_fk.sql
-- HYBRID Phase 4b: drop FK record_id -> entity_records.id on aux tables so they
-- work for table-backed records (which live in er_<id>, NOT entity_records).
-- company_id FK -> companies stays, so deleting a company still cascades cleanup.
-- Trade-off: per-record HARD delete no longer auto-cascades these aux rows
-- (orphans possible; soft-delete is unaffected; hard delete is a rare admin op).
-- Constraint-name-agnostic: discover the FK by catalog, drop whatever its name is.

DO $$
DECLARE
  t text;
  c text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'entity_record_embeddings',
    'record_field_ops',
    'record_presence',
    'entity_record_versions',
    'entity_record_timeseries'
  ] LOOP
    FOR c IN
      SELECT conname FROM pg_constraint
      WHERE contype = 'f'
        AND conrelid = t::regclass
        AND confrelid = 'entity_records'::regclass
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, c);
    END LOOP;
  END LOOP;
END $$;
