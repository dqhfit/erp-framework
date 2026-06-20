import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { entities } from "./entities";
import { runStatus } from "./enums";
import { companies } from "./tenant";

export const entityRecordTimeseries = pgTable(
  "entity_record_timeseries",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // FK record_id -> entity_records.id BỎ ở migration 0071 (HYBRID Phase 4b):
    // record entity tier='table' sống ở er_<id>, không ở entity_records; company_id
    // FK giữ nguyên nên xoá công ty vẫn cascade dọn. Xem docs/HYBRID-STORAGE.md.
    recordId: uuid("record_id").notNull(),
    fieldName: text("field_name").notNull(),
    ts: timestamp("ts").defaultNow().notNull(),
    value: doublePrecision("value").notNull(),
    meta: jsonb("meta"),
  },
  (t) => ({
    recordFieldTsIdx: index("ert_record_field_ts_idx").on(t.recordId, t.fieldName, t.ts),
    tsIdx: index("ert_ts_idx").on(t.ts),
  }),
);

/* ─── Plugin — đăng ký/bật-tắt plugin theo công ty ───────── */
export const pluginRegistrations = pgTable(
  "plugin_registrations",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // định danh plugin
    version: text("version").notNull().default("1.0.0"),
    manifest: jsonb("manifest").notNull().default(sql`'{}'::jsonb`),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyNameIdx: uniqueIndex("plugin_registrations_company_name_idx").on(t.companyId, t.name),
  }),
);

/* ─── Embed — token nhúng builder vào sản phẩm khác ──────── */
export const embedTokens = pgTable(
  "embed_tokens",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    label: text("label").notNull().default(""),
    // scope: phạm vi nhúng — "page" | "workflow" | "entity" | "all"
    scope: text("scope").notNull().default("all"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    companyIdIdx: index("embed_tokens_company_id_idx").on(t.companyId),
  }),
);

/* ─── Entity Sync — đồng bộ tự động dữ liệu MCP → entity_records ──
   Mỗi entity tối đa 1 cấu hình sync. Scheduler quét cronExpr; tới
   hạn thì gọi tool "list" đã bind của entity, upsert vào DB theo
   pkField. Khác heartbeat (agent chạy) — đây là kéo dữ liệu thuần. */
export const entitySyncs = pgTable(
  "entity_syncs",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    cronExpr: text("cron_expr").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    // pkField: field khoá để khớp bản ghi khi upsert. rỗng = tự suy luận.
    pkField: text("pk_field").notNull().default(""),
    lastRun: timestamp("last_run"),
    lastStatus: runStatus("last_status"),
    lastSummary: text("last_summary"), // "thêm N, cập nhật M" / lỗi
    runCount: integer("run_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyIdIdx: index("entity_syncs_company_id_idx").on(t.companyId),
    entityIdIdx: uniqueIndex("entity_syncs_entity_id_idx").on(t.entityId),
  }),
);
