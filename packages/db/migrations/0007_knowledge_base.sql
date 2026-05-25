/* 0007_knowledge_base.sql -- Knowledge Base (RAG).
   - Bat extension pgvector (image DB phai la pgvector/pgvector:pg18).
   - llm_profiles.kind: phan biet profile chat voi profile embedding.
   - knowledge_sources + knowledge_chunks: nguon tri thuc + doan co
     embedding vector(768). Index HNSW cosine cho tra cuu ANN --
     drizzle-kit khong sinh kieu index nay nen viet tay o day.
   Bang moi, khong can backfill. */

CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
ALTER TABLE "llm_profiles" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'chat' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_sources" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"content" text NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"embedding" vector(768)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_sources_company_id_idx" ON "knowledge_sources" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_chunks_company_id_idx" ON "knowledge_chunks" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_chunks_source_id_idx" ON "knowledge_chunks" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_chunks_embedding_hnsw_idx" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);
