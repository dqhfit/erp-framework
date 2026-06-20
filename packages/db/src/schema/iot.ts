import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./tenant";

/* ─── IoT — thiết bị gửi/nhận dữ liệu ───────────────────── */
/* Registry thiết bị: device_key_hash = SHA-256 hex của device key
   (key chỉ hiện 1 lần khi tạo). Multi-tenant qua company_id. */
export const iotDevices = pgTable(
  "iot_devices",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    label: text("label"),
    deviceKeyHash: text("device_key_hash").notNull(),
    meta: jsonb("meta").notNull().default(sql`'{}'::jsonb`),
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    keyHashIdx: uniqueIndex("iot_devices_key_hash_idx").on(t.deviceKeyHash),
    companyIdx: index("iot_devices_company_idx").on(t.companyId),
  }),
);

/* Telemetry stream — append-only. Mỗi bản ghi là một mẫu thiết bị
   gửi lên (sensor reading, event, log…). Channel là "topic" mềm để
   phân loại (vd "temperature", "door", "alert"). */
export const iotTelemetry = pgTable(
  "iot_telemetry",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => iotDevices.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    payload: jsonb("payload").notNull(),
    ts: timestamp("ts").defaultNow().notNull(),
  },
  (t) => ({
    deviceTsIdx: index("iot_telemetry_device_ts_idx").on(t.deviceId, t.ts),
    companyTsIdx: index("iot_telemetry_company_ts_idx").on(t.companyId, t.ts),
  }),
);

/* Hàng đợi lệnh server → thiết bị. status: pending → sent → ack/error.
   Device pull qua GET /iot/v1/commands hoặc nhận push qua MQTT. */
export const iotCommands = pgTable(
  "iot_commands",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => iotDevices.id, { onDelete: "cascade" }),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    result: jsonb("result"),
    sentAt: timestamp("sent_at"),
    ackedAt: timestamp("acked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    deviceStatusIdx: index("iot_commands_device_status_idx").on(t.deviceId, t.status),
  }),
);
