/* 0016_record_fts.sql — Full-text search cho entity_records.
   - search_tsv tsvector: cập nhật từ trigger gộp giá trị các field
     được mark "searchable" trong entities.fields[].searchable=true.
   - GIN index trên tsvector để truy vấn nhanh @@.
   - search dùng config "simple" (không stemming) cho đa ngôn ngữ;
     tiếng Việt unaccent nếu cần làm v2. */

ALTER TABLE "entity_records" ADD COLUMN IF NOT EXISTS "search_tsv" tsvector;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_records_search_tsv_idx" ON "entity_records" USING gin ("search_tsv");
--> statement-breakpoint

/* Trigger function — duyệt fields của entity, gom các field searchable
   thành 1 chuỗi rồi to_tsvector. Nếu không có field nào searchable, set
   tsv = NULL. */
CREATE OR REPLACE FUNCTION entity_records_update_tsv()
RETURNS TRIGGER AS $$
DECLARE
  ent_fields jsonb;
  parts text := '';
  f jsonb;
  fname text;
  fval text;
BEGIN
  SELECT fields INTO ent_fields FROM entities WHERE id = NEW.entity_id;
  IF ent_fields IS NULL THEN
    NEW.search_tsv := NULL;
    RETURN NEW;
  END IF;
  FOR f IN SELECT * FROM jsonb_array_elements(ent_fields) LOOP
    IF (f->>'searchable')::boolean IS TRUE THEN
      fname := f->>'name';
      fval := NEW.data->>fname;
      IF fval IS NOT NULL AND fval <> '' THEN
        parts := parts || ' ' || fval;
      END IF;
    END IF;
  END LOOP;
  IF parts = '' THEN
    NEW.search_tsv := NULL;
  ELSE
    NEW.search_tsv := to_tsvector('simple', parts);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS entity_records_tsv_trg ON "entity_records";
--> statement-breakpoint
CREATE TRIGGER entity_records_tsv_trg
  BEFORE INSERT OR UPDATE OF data, entity_id ON "entity_records"
  FOR EACH ROW EXECUTE FUNCTION entity_records_update_tsv();
