/* 0040_pgvector_ivfflat_indexes.sql -- IVFFlat index cho semantic search.
   Khong co index: pgvector lam linear scan tat ca row -> O(N) cho moi
   query. Voi >5k row, latency tang dang ke.
   IVFFlat: probabilistic, lists = sqrt(N) cho dataset 1k-100k.
   vector_cosine_ops vi tat ca query dung toan tu <=> (cosine distance).
   CONCURRENTLY khong dung trong drizzle transaction wrap -> dung
   IF NOT EXISTS de tranh fail khi re-run. */

CREATE INDEX IF NOT EXISTS "ere_embedding_ivfflat_idx"
  ON "entity_record_embeddings" USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "kc_embedding_ivfflat_idx"
  ON "knowledge_chunks" USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "feedbacks_embedding_ivfflat_idx"
  ON "feedbacks" USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100);
