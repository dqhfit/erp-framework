/* 0027_perf_indexes.sql — Performance indexes.
   - pg_trgm extension + GIN index trên entity_records.data jsonb text expr
     để pre-filter duplicate detection trước Levenshtein.
   - pgvector IVFFlat index trên entity_record_embeddings.embedding cho
     semantic search nhanh (cần ANALYSE trước khi build hiệu quả; tự
     ngầm xử lý). Cosine ops cho similarity (1 - distance). */

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

/* GIN trigram trên text representation của data — Postgres cast jsonb
   sang text qua ::text. Cho phép similarity search nhanh trên toàn data.
   Hiệu quả nhất khi dataset > 10k rows; nhỏ hơn vẫn dùng được. */
CREATE INDEX IF NOT EXISTS "entity_records_data_trgm_idx"
  ON "entity_records" USING gin ((data::text) gin_trgm_ops)
  WHERE deleted_at IS NULL;
--> statement-breakpoint

/* IVFFlat cho pgvector cosine search. lists = ~sqrt(N) cho ~1k-10k row;
   tăng lên với dataset lớn hơn. Postgres cần ANALYSE trước khi build
   hiệu quả nhất; sẽ tự cải thiện sau lần ANALYSE đầu. */
CREATE INDEX IF NOT EXISTS "ere_embedding_ivfflat_idx"
  ON "entity_record_embeddings"
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 32);
