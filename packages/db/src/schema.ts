/* ==========================================================
   schema.ts — Drizzle schema toàn bộ bảng HỆ THỐNG của ERP
   Framework. Dữ liệu động của entity do user tạo nằm trong
   entity_records.data (JSONB) — xem UPGRADE-PLAN mục 3.4.
   Khóa chính dùng uuidv7() — yêu cầu PostgreSQL 18+ (UUID có thứ tự
   thời gian, tốt cho locality của B-tree index).
   ========================================================== */
import {
  pgTable, pgEnum, uuid, text, timestamp, jsonb, boolean, integer,
  doublePrecision, index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ─── Người dùng & phiên ────────────────────────────────── */
export const userRole = pgEnum("user_role", ["admin", "editor", "viewer"]);

export const users = pgTable("users", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull().default("viewer"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),                       // token phiên ngẫu nhiên
  userId: uuid("user_id").notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/* ─── Metadata low-code (định nghĩa do designer tạo) ─────── */
export const entities = pgTable("entities", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  name: text("name").notNull().unique(),             // định danh máy: "so_don_hang"
  label: text("label").notNull(),                    // nhãn hiển thị
  icon: text("icon"),
  fields: jsonb("fields").notNull().default(sql`'[]'::jsonb`),
  // meta: dữ liệu phụ tầng app không thuộc cột typed — vd { mcp, mcpBindings }.
  meta: jsonb("meta").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/* Dữ liệu thực tế của entity động — JSONB. Index: btree(entityId)
   + GIN(data) riêng; index khoảng/sort viết SQL thô trong migration. */
export const entityRecords = pgTable("entity_records", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  entityId: uuid("entity_id").notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  schemaVersion: text("schema_version").notNull().default("1"),
  data: jsonb("data").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  entityIdIdx: index("entity_records_entity_id_idx").on(t.entityId),
  dataGinIdx: index("entity_records_data_gin_idx")
    .using("gin", sql`${t.data} jsonb_path_ops`),
}));

export const pages = pgTable("pages", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  name: text("name").notNull().unique(),
  label: text("label").notNull(),
  icon: text("icon"),
  content: jsonb("content").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const workflowTrigger = pgEnum("workflow_trigger", [
  "manual", "webhook", "cron", "entity_changed",
]);

export const workflows = pgTable("workflows", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  name: text("name").notNull(),
  triggerType: workflowTrigger("trigger_type").notNull().default("manual"),
  graph: jsonb("graph").notNull().default(sql`'{"nodes":[],"edges":[]}'::jsonb`),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const agents = pgTable("agents", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  name: text("name").notNull(),
  model: text("model").notNull(),
  config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/* ─── Cấu hình tích hợp ──────────────────────────────────── */
export const mcpConfigs = pgTable("mcp_configs", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  name: text("name").notNull().unique(),
  config: jsonb("config").notNull(),                 // { mode, url, headers }
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const llmProfiles = pgTable("llm_profiles", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  name: text("name").notNull().unique(),
  adapter: text("adapter").notNull(),
  model: text("model").notNull(),
  endpoint: text("endpoint"),
  apiKeyEnc: text("api_key_enc"),                    // mã hoá ở tầng app, không plaintext
  temperature: doublePrecision("temperature").default(0.7),
  maxTokens: integer("max_tokens").default(4096),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/* ─── Vận hành: nhật ký, lịch, lần chạy ──────────────────── */
export const activityLog = pgTable("activity_log", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  at: timestamp("at").defaultNow().notNull(),
  kind: text("kind").notNull(),
  objectType: text("object_type"),
  target: text("target"),
  detail: text("detail").notNull(),
  tokensInput: integer("tokens_input"),
  tokensOutput: integer("tokens_output"),
  model: text("model"),
  cost: doublePrecision("cost"),
  actorUserId: uuid("actor_user_id").references(() => users.id),
}, (t) => ({
  atIdx: index("activity_log_at_idx").on(t.at),
}));

export const runStatus = pgEnum("run_status", [
  "running", "completed", "paused", "error",
]);

export const schedules = pgTable("schedules", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  workflowId: uuid("workflow_id").notNull()
    .references(() => workflows.id, { onDelete: "cascade" }),
  cronExpr: text("cron_expr").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastRun: timestamp("last_run"),
  lastStatus: runStatus("last_status"),
  runCount: integer("run_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const workflowRuns = pgTable("workflow_runs", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  workflowId: uuid("workflow_id").notNull()
    .references(() => workflows.id, { onDelete: "cascade" }),
  scheduleId: uuid("schedule_id")
    .references(() => schedules.id, { onDelete: "set null" }),
  status: runStatus("status").notNull().default("running"),
  steps: jsonb("steps").notNull().default(sql`'[]'::jsonb`),
  vars: jsonb("vars").notNull().default(sql`'{}'::jsonb`),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
}, (t) => ({
  workflowIdIdx: index("workflow_runs_workflow_id_idx").on(t.workflowId),
}));
