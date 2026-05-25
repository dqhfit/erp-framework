/* 0028_approval_link_timeseries.sql — Link approval với entity record
   + bảng time-series cho field type "timeseries".

   approval_requests thêm:
   - entity_id + record_id: link tới record cụ thể.
   - patch: JSONB chứa thay đổi pending — server apply khi approve.

   entity_record_timeseries: lưu giá trị theo thời gian per (record, field).
   Dùng cho temperature/sensor/stock-price/heart-rate. */

ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "entity_id" uuid;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "record_id" uuid;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN IF NOT EXISTS "patch" jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_record_idx" ON "approval_requests" ("record_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "entity_record_timeseries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	"ts" timestamp NOT NULL DEFAULT now(),
	"value" double precision NOT NULL,
	"meta" jsonb
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_record_timeseries" ADD CONSTRAINT "ert_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_record_timeseries" ADD CONSTRAINT "ert_record_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."entity_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ert_record_field_ts_idx" ON "entity_record_timeseries" ("record_id", "field_name", "ts" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ert_ts_idx" ON "entity_record_timeseries" ("ts" DESC);
