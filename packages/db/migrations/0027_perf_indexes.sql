/* 0027_perf_indexes.sql -- Performance indexes.
   - pg_trgm extension + GIN index tren entity_records.data jsonb text expr
     de pre-filter duplicate detection truoc Levenshtein.
   - pgvector IVFFlat index tren entity_record_embeddings.embedding cho
     semantic search nhanh (can ANALYSE truoc khi build hieu qua; tu
     ngam xu ly). Cosine ops cho similarity (1 - distance). */

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

/* GIN trigram tren text representation cua data -- Postgres cast jsonb
   sang text qua ::text. Cho phep similarity search nhanh tren toan data.
   Hieu qua nhat khi dataset > 10k rows; nho hon van dung duoc. */
CREATE INDEX IF NOT EXISTS "entity_records_data_trgm_idx"
  ON "entity_records" USING gin ((data::text) gin_trgm_ops)
  WHERE deleted_at IS NULL;
--> statement-breakpoint

/* IVFFlat cho pgvector cosine search. lists = ~sqrt(N) cho ~1k-10k row;
   tang len voi dataset lon hon. Postgres can ANALYSE truoc khi build
   hieu qua nhat; se tu cai thien sau lan ANALYSE dau. */
CREATE INDEX IF NOT EXISTS "ere_embedding_ivfflat_idx"
  ON "entity_record_embeddings"
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 32);
