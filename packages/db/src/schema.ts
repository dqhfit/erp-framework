/* ==========================================================
   schema.ts — Drizzle schema toàn bộ bảng HỆ THỐNG của ERP
   Framework. Dữ liệu động của entity do user tạo nằm trong
   entity_records.data (JSONB) — xem UPGRADE-PLAN mục 3.4.
   Khóa chính dùng uuidv7() — yêu cầu PostgreSQL 18+ (UUID có thứ tự
   thời gian, tốt cho locality của B-tree index).

   ĐA CÔNG TY (multi-tenant): mọi bảng dữ liệu mang cột company_id.
   Một user có thể là thành viên nhiều công ty (bảng company_members)
   và chuyển qua lại — công ty đang chọn lưu ở sessions.active_company_id.
   ========================================================== */
import {
  pgTable, pgEnum, uuid, text, timestamp, jsonb, boolean, integer,
  doublePrecision, index, uniqueIndex, type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ─── Người dùng & phiên ────────────────────────────────── */
export const userRole = pgEnum("user_role", ["admin", "editor", "viewer"]);

export const users = pgTable("users", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  // role: vai trò mặc định khi tạo công ty mới — vai trò HIỆU LỰC theo
  // từng công ty nằm ở company_members.role.
  role: userRole("role").notNull().default("viewer"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/* ─── Đa công ty (multi-tenant) ─────────────────────────── */
export const companies = pgTable("companies", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),             // định danh URL-an-toàn
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/* Thành viên công ty: user × company × role. Một user nhiều công ty. */
export const companyMembers = pgTable("company_members", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: userRole("role").notNull().default("viewer"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  companyUserIdx: uniqueIndex("company_members_company_user_idx")
    .on(t.companyId, t.userId),
  userIdx: index("company_members_user_id_idx").on(t.userId),
}));

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),                       // token phiên ngẫu nhiên
  userId: uuid("user_id").notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Công ty đang chọn của phiên. null = dùng công ty đầu tiên user là thành viên.
  activeCompanyId: uuid("active_company_id")
    .references(() => companies.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/* ─── Metadata low-code (định nghĩa do designer tạo) ─────── */
export const entities = pgTable("entities", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),                      // định danh máy: "so_don_hang"
  label: text("label").notNull(),                    // nhãn hiển thị
  icon: text("icon"),
  fields: jsonb("fields").notNull().default(sql`'[]'::jsonb`),
  // meta: dữ liệu phụ tầng app không thuộc cột typed — vd { mcp, mcpBindings }.
  meta: jsonb("meta").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  companyNameIdx: uniqueIndex("entities_company_name_idx")
    .on(t.companyId, t.name),
}));

/* Dữ liệu thực tế của entity động — JSONB. Index: btree(entityId)
   + GIN(data) riêng; index khoảng/sort viết SQL thô trong migration. */
export const entityRecords = pgTable("entity_records", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  entityId: uuid("entity_id").notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  schemaVersion: text("schema_version").notNull().default("1"),
  data: jsonb("data").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  entityIdIdx: index("entity_records_entity_id_idx").on(t.entityId),
  companyIdIdx: index("entity_records_company_id_idx").on(t.companyId),
  dataGinIdx: index("entity_records_data_gin_idx")
    .using("gin", sql`${t.data} jsonb_path_ops`),
}));

export const pages = pgTable("pages", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  label: text("label").notNull(),
  icon: text("icon"),
  content: jsonb("content").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  companyNameIdx: uniqueIndex("pages_company_name_idx")
    .on(t.companyId, t.name),
}));

export const workflowTrigger = pgEnum("workflow_trigger", [
  "manual", "webhook", "cron", "entity_changed",
]);

export const workflows = pgTable("workflows", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  triggerType: workflowTrigger("trigger_type").notNull().default("manual"),
  // graph: bản NHÁP do designer chỉnh.
  graph: jsonb("graph").notNull().default(sql`'{"nodes":[],"edges":[]}'::jsonb`),
  // publishedGraph: bản ĐÃ PUBLISH — runner chạy bản này. null = chưa publish.
  publishedGraph: jsonb("published_graph"),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  companyIdIdx: index("workflows_company_id_idx").on(t.companyId),
}));

export const agents = pgTable("agents", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  model: text("model").notNull(),
  config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
  // managerId: agent cấp trên (org chart / phân cấp agent). null = cấp cao nhất.
  managerId: uuid("manager_id")
    .references((): AnyPgColumn => agents.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  companyIdIdx: index("agents_company_id_idx").on(t.companyId),
}));

/* ─── Cấu hình tích hợp ──────────────────────────────────── */
export const mcpConfigs = pgTable("mcp_configs", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  config: jsonb("config").notNull(),                 // { mode, url, headers }
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  companyNameIdx: uniqueIndex("mcp_configs_company_name_idx")
    .on(t.companyId, t.name),
}));

export const llmProfiles = pgTable("llm_profiles", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  adapter: text("adapter").notNull(),
  model: text("model").notNull(),
  endpoint: text("endpoint"),
  apiKeyEnc: text("api_key_enc"),                    // mã hoá ở tầng app, không plaintext
  temperature: doublePrecision("temperature").default(0.7),
  maxTokens: integer("max_tokens").default(4096),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  companyNameIdx: uniqueIndex("llm_profiles_company_name_idx")
    .on(t.companyId, t.name),
}));

/* ─── Vận hành: nhật ký, lịch, lần chạy ──────────────────── */
export const activityLog = pgTable("activity_log", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
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
  companyIdIdx: index("activity_log_company_id_idx").on(t.companyId),
}));

export const runStatus = pgEnum("run_status", [
  "running", "completed", "paused", "error",
]);

export const schedules = pgTable("schedules", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
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
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
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

/* ─── Heartbeat — agent tự thức dậy theo lịch & hành động ─── */
export const agentHeartbeats = pgTable("agent_heartbeats", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  cronExpr: text("cron_expr").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  // prompt: chỉ dẫn agent thực hiện mỗi nhịp (vd "tổng hợp đơn hàng mới").
  prompt: text("prompt").notNull(),
  lastRun: timestamp("last_run"),
  lastStatus: runStatus("last_status"),
  lastSummary: text("last_summary"),            // tóm tắt kết quả nhịp gần nhất
  runCount: integer("run_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  companyIdIdx: index("agent_heartbeats_company_id_idx").on(t.companyId),
  agentIdIdx: index("agent_heartbeats_agent_id_idx").on(t.agentId),
}));

/* ─── Governance — yêu cầu phê duyệt nhiều tầng ──────────── */
export const approvalStatus = pgEnum("approval_status", [
  "pending", "approved", "rejected",
]);

export const approvalRequests = pgTable("approval_requests", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  detail: text("detail").notNull().default(""),
  // kind: loại đối tượng cần duyệt — "workflow" | "agent" | "expense"…
  kind: text("kind").notNull().default("general"),
  status: approvalStatus("status").notNull().default("pending"),
  // requiredApprovals: số phê duyệt cần đạt (đa tầng).
  requiredApprovals: integer("required_approvals").notNull().default(1),
  // decisions: [{ userId, decision: "approve"|"reject", comment, at }]
  decisions: jsonb("decisions").notNull().default(sql`'[]'::jsonb`),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  decidedAt: timestamp("decided_at"),
}, (t) => ({
  companyIdIdx: index("approval_requests_company_id_idx").on(t.companyId),
}));

/* ─── Plugin — đăng ký/bật-tắt plugin theo công ty ───────── */
export const pluginRegistrations = pgTable("plugin_registrations", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),                  // định danh plugin
  version: text("version").notNull().default("1.0.0"),
  manifest: jsonb("manifest").notNull().default(sql`'{}'::jsonb`),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  companyNameIdx: uniqueIndex("plugin_registrations_company_name_idx")
    .on(t.companyId, t.name),
}));

/* ─── Embed — token nhúng builder vào sản phẩm khác ──────── */
export const embedTokens = pgTable("embed_tokens", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  label: text("label").notNull().default(""),
  // scope: phạm vi nhúng — "page" | "workflow" | "entity" | "all"
  scope: text("scope").notNull().default("all"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  companyIdIdx: index("embed_tokens_company_id_idx").on(t.companyId),
}));

/* ─── Entity Sync — đồng bộ tự động dữ liệu MCP → entity_records ──
   Mỗi entity tối đa 1 cấu hình sync. Scheduler quét cronExpr; tới
   hạn thì gọi tool "list" đã bind của entity, upsert vào DB theo
   pkField. Khác heartbeat (agent chạy) — đây là kéo dữ liệu thuần. */
export const entitySyncs = pgTable("entity_syncs", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  entityId: uuid("entity_id").notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  cronExpr: text("cron_expr").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  // pkField: field khoá để khớp bản ghi khi upsert. rỗng = tự suy luận.
  pkField: text("pk_field").notNull().default(""),
  lastRun: timestamp("last_run"),
  lastStatus: runStatus("last_status"),
  lastSummary: text("last_summary"),            // "thêm N, cập nhật M" / lỗi
  runCount: integer("run_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  companyIdIdx: index("entity_syncs_company_id_idx").on(t.companyId),
  entityIdIdx: uniqueIndex("entity_syncs_entity_id_idx").on(t.entityId),
}));
