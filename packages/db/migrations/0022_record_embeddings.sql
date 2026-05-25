/* 0022_record_embeddings.sql — Embedding semantic search per record.
   1 record = 1 embedding tổng hợp từ các field marked embedSearchable.
   Dùng pgvector (đã có ở migration 0007). 768 chiều cho nomic-embed-text
   của Ollama. Khác chiều adapter → migration extra cần plan. */

CREATE TABLE IF NOT EXISTS "entity_record_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_record_embeddings" ADD CONSTRAINT "ere_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_record_embeddings" ADD CONSTRAINT "ere_record_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."entity_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_record_embeddings" ADD CONSTRAINT "ere_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ere_record_uidx" ON "entity_record_embeddings" ("record_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ere_entity_idx" ON "entity_record_embeddings" ("entity_id");
--> statement-breakpoint
/* IVFFlat index — pgvector require analyse trước khi build hiệu quả; bỏ
   qua ở v1 (recordset nhỏ vẫn nhanh với sequential scan). */
