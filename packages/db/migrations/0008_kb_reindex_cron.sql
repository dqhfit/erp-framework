/* 0008_kb_reindex_cron.sql — Knowledge Base: tự nạp lại theo lịch.
   Thêm cột reindex_cron trên knowledge_sources — biểu thức cron để
   scheduler tự enqueue kb-ingest (chỉ dùng cho nguồn kind=entity).
   null = tắt tự động. Bảng có sẵn, chỉ thêm cột. */

ALTER TABLE "knowledge_sources" ADD COLUMN IF NOT EXISTS "reindex_cron" text;
