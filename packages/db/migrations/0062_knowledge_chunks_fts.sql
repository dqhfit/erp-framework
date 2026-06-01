/* 0062_knowledge_chunks_fts.sql -- Full-text search cho knowledge_chunks.
   Bo sung nhanh BM25-style keyword search ben canh ANN cosine san co
   (HNSW, migration 0007) de lam hybrid retrieval -- vector bat nghia,
   FTS bat tu khoa/ma/ten rieng ma embedding hay bo sot.

   - search_tsv: GENERATED column tu chinh cot content. Khac voi
     entity_records (0016) phai dung trigger vi gom nhieu field dong, o
     day content la nguon duy nhat nen generated column don gian va luon
     dong bo, tu backfill khi them cot.
   - Config "simple" (khong stemming) cho da ngon ngu, dong nhat voi
     entity_records FTS. Dung to_tsvector 2 tham so (IMMUTABLE) de hop le
     trong generated column.
   - GIN index cho truy van @@ nhanh. */

ALTER TABLE "knowledge_chunks"
  ADD COLUMN IF NOT EXISTS "search_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce("content", ''))) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_chunks_search_tsv_idx"
  ON "knowledge_chunks" USING gin ("search_tsv");
