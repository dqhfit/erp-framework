/* 0026_rollup_cache.sql -- Cache gia tri rollup field tai entity_records.
   rollup_cache JSONB: { field_name: { v, computedAt } }
   rollup_invalidated boolean: marker de compute lai lan read tiep theo.
   Invalidation: server hook records.create/update/delete tren entity
   nguon -> set rollup_invalidated=true cho records dich. */

ALTER TABLE "entity_records" ADD COLUMN IF NOT EXISTS "rollup_cache" jsonb;
--> statement-breakpoint
ALTER TABLE "entity_records" ADD COLUMN IF NOT EXISTS "rollup_invalidated" boolean NOT NULL DEFAULT true;
