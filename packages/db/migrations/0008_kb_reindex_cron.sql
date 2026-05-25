/* 0008_kb_reindex_cron.sql -- Knowledge Base: tu nap lai theo lich.
   Them cot reindex_cron tren knowledge_sources -- bieu thuc cron de
   scheduler tu enqueue kb-ingest (chi dung cho nguon kind=entity).
   null = tat tu dong. Bang co san, chi them cot. */

ALTER TABLE "knowledge_sources" ADD COLUMN IF NOT EXISTS "reindex_cron" text;
