/* 0009_iot.sql — Module IoT.
   - Mở rộng workflow_trigger: thêm 'iot_telemetry' để workflow kích
     hoạt khi nhận telemetry khớp filter.
   - Thêm cột trigger_config (jsonb) vào workflows — chứa filter
     device/channel cho iot_telemetry (và cấu hình trigger khác sau này).
   - 3 bảng mới: iot_devices (registry), iot_telemetry (stream
     append-only), iot_commands (queue gửi xuống thiết bị).
   Multi-tenant qua company_id. */

ALTER TYPE "workflow_trigger" ADD VALUE IF NOT EXISTS 'iot_telemetry';

ALTER TABLE "workflows"
  ADD COLUMN IF NOT EXISTS "trigger_config" jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS "iot_devices" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "label" text,
  /* Hash SHA-256 hex của device key — key chỉ hiện 1 lần lúc tạo. */
  "device_key_hash" text NOT NULL,
  "meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_seen_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "iot_devices_key_hash_idx"
  ON "iot_devices"("device_key_hash");
CREATE INDEX IF NOT EXISTS "iot_devices_company_idx"
  ON "iot_devices"("company_id");

CREATE TABLE IF NOT EXISTS "iot_telemetry" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "device_id" uuid NOT NULL REFERENCES "iot_devices"("id") ON DELETE CASCADE,
  "channel" text NOT NULL,
  "payload" jsonb NOT NULL,
  "ts" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "iot_telemetry_device_ts_idx"
  ON "iot_telemetry"("device_id", "ts");
CREATE INDEX IF NOT EXISTS "iot_telemetry_company_ts_idx"
  ON "iot_telemetry"("company_id", "ts");

CREATE TABLE IF NOT EXISTS "iot_commands" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "device_id" uuid NOT NULL REFERENCES "iot_devices"("id") ON DELETE CASCADE,
  "payload" jsonb NOT NULL,
  /* pending → sent → ack | error */
  "status" text NOT NULL DEFAULT 'pending',
  "result" jsonb,
  "sent_at" timestamp,
  "acked_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "iot_commands_device_status_idx"
  ON "iot_commands"("device_id", "status");
