/* 0026_rollup_cache.sql — Cache giá trị rollup field tại entity_records.
   rollup_cache JSONB: { field_name: { v, computedAt } }
   rollup_invalidated boolean: marker để compute lại lần read tiếp theo.
   Invalidation: server hook records.create/update/delete trên entity
   nguồn → set rollup_invalidated=true cho records đích. */

ALTER TABLE "entity_records" ADD COLUMN IF NOT EXISTS "rollup_cache" jsonb;
--> statement-breakpoint
ALTER TABLE "entity_records" ADD COLUMN IF NOT EXISTS "rollup_invalidated" boolean NOT NULL DEFAULT true;
