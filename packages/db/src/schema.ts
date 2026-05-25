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
  doublePrecision, index, uniqueIndex, vector, primaryKey, type AnyPgColumn,
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
  // primaryAgentId: "agent chính" của user — Topbar/AgentPanel ưu tiên bind
  // vào agent này khi không có route /agents/$id. Optional; null = chưa chọn,
  // fallback xuống CEO mặc định của công ty (xem AgentPanel).
  primaryAgentId: uuid("primary_agent_id")
    .references((): AnyPgColumn => agents.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/* Invite token để admin mời user mới — user dùng link /invite?token=...
   để tự đặt mật khẩu lần đầu. Token random 32 byte base64url, dùng 1 lần.
   accepted_at != null = đã consume; expires_at < now = hết hạn. */
export const userInvites = pgTable("user_invites", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  userId: uuid("user_id").notNull()
    .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull()
    .references((): AnyPgColumn => companies.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  role: userRole("role").notNull().default("viewer"),
  invitedBy: uuid("invited_by")
    .references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tokenIdx: uniqueIndex("user_invites_token_idx").on(t.token),
  userIdx: index("user_invites_user_idx").on(t.userId),
  companyIdx: index("user_invites_company_idx").on(t.companyId),
}));

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
   + GIN(data) riêng; index khoảng/sort viết SQL thô trong migration.
   - deletedAt: soft delete; null = active, ts = đã xoá nhưng còn restore được.
   - version: optimistic lock counter — caller update phải gửi expectedVersion. */
export const entityRecords = pgTable("entity_records", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  entityId: uuid("entity_id").notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  schemaVersion: text("schema_version").notNull().default("1"),
  data: jsonb("data").notNull(),
  version: integer("version").notNull().default(0),
  deletedAt: timestamp("deleted_at"),
  // search_tsv được trigger Postgres cập nhật tự động từ field
  // entities.fields[].searchable=true (xem migration 0016). Drizzle
  // chỉ khai báo cột để TypeScript biết — không bind dynamic queries.
  searchTsv: text("search_tsv"),
  // Rollup cache — { fieldName: { v, computedAt } }. Invalidated khi
  // source entity records.create/update/delete → set rollup_invalidated.
  rollupCache: jsonb("rollup_cache"),
  rollupInvalidated: boolean("rollup_invalidated").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  entityIdIdx: index("entity_records_entity_id_idx").on(t.entityId),
  companyIdIdx: index("entity_records_company_id_idx").on(t.companyId),
  deletedAtIdx: index("entity_records_deleted_at_idx").on(t.deletedAt),
  dataGinIdx: index("entity_records_data_gin_idx")
    .using("gin", sql`${t.data} jsonb_path_ops`),
}));

/* Embedding semantic search per record — gom field marked embedSearchable
   thành 1 chuỗi → embed → index. 768 chiều cho nomic-embed-text. */
export const entityRecordEmbeddings = pgTable("entity_record_embeddings", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  recordId: uuid("record_id").notNull()
    .references(() => entityRecords.id, { onDelete: "cascade" }),
  entityId: uuid("entity_id").notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  embedding: vector("embedding", { dimensions: 768 }).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  recordUidx: uniqueIndex("ere_record_uidx").on(t.recordId),
  entityIdx: index("ere_entity_idx").on(t.entityId),
}));

/* Comments per record + nested replies (parent_id self-ref). Soft delete. */
export const recordComments = pgTable("record_comments", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  recordId: uuid("record_id").notNull(),
  parentId: uuid("parent_id"),
  authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (t) => ({
  recordIdx: index("record_comments_record_idx").on(t.recordId),
  parentIdx: index("record_comments_parent_idx").on(t.parentId),
}));

/* In-app notifications — mention / comment / webhook_failure / system.
   read_at NULL = chưa đọc. user_id = recipient; actor_user_id = ai gây ra. */
export const notifications = pgTable("notifications", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  targetRecordId: uuid("target_record_id"),
  targetUrl: text("target_url"),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("notifications_user_idx").on(t.userId, t.readAt),
  recordIdx: index("notifications_record_idx").on(t.targetRecordId),
}));

/* Presence "đang xem" per record per user — UPSERT mỗi ping client. */
export const recordPresence = pgTable("record_presence", {
  recordId: uuid("record_id").notNull()
    .references(() => entityRecords.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.recordId, t.userId] }),
  lastSeenIdx: index("rp_last_seen_idx").on(t.lastSeen),
}));

/* Templates print/email per entity — Mustache-like {{field}} substitution
   với record data. kind: "print" (HTML cho in/PDF) hoặc "email" (subject+body). */
export const entityTemplates = pgTable("entity_templates", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  entityId: uuid("entity_id").notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  entityIdx: index("et_entity_idx").on(t.entityId, t.kind),
}));

/* Outgoing webhooks per entity — fire-and-forget HTTP POST khi event
   create/update/delete. HMAC-SHA256 signature qua secret + body. */
export const entityWebhooks = pgTable("entity_webhooks", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  entityId: uuid("entity_id").notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  events: jsonb("events").notNull().default(sql`'["create","update","delete"]'::jsonb`),
  headers: jsonb("headers"),
  secret: text("secret"),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastFiredAt: timestamp("last_fired_at"),
  lastStatus: integer("last_status"),
}, (t) => ({
  entityIdx: index("entity_webhooks_entity_idx").on(t.entityId),
}));

/* Lịch sử bản ghi entity — mỗi update tạo 1 row. Cho phép audit (ai,
   khi nào, đổi gì từ X→Y) + revert về version trước. */
export const entityRecordVersions = pgTable("entity_record_versions", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  recordId: uuid("record_id").notNull()
    .references(() => entityRecords.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  data: jsonb("data").notNull(),
  diff: jsonb("diff").notNull().default(sql`'{}'::jsonb`),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  recordIdIdx: index("entity_record_versions_record_id_idx").on(t.recordId),
  recordVersionIdx: index("entity_record_versions_record_version_idx")
    .on(t.recordId, t.version),
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
  "manual", "webhook", "cron", "entity_changed", "iot_telemetry",
]);

export const workflows = pgTable("workflows", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  triggerType: workflowTrigger("trigger_type").notNull().default("manual"),
  // triggerConfig: cấu hình trigger (filter device/channel cho iot_telemetry,
  // hoặc cấu hình trigger khác). Mỗi triggerType tự quy ước schema con.
  triggerConfig: jsonb("trigger_config").notNull().default(sql`'{}'::jsonb`),
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
  // config.isPrivate (boolean, optional): true → ACL chặt theo agent_members;
  // false/undefined → fallback về company-RBAC (mọi editor đều edit OK). Xem
  // packages/server/src/agent-acl.ts.
  config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
  // managerId: agent cấp trên (org chart / phân cấp agent). null = cấp cao nhất.
  managerId: uuid("manager_id")
    .references((): AnyPgColumn => agents.id, { onDelete: "set null" }),
  // createdBy: ai tạo agent — set khi insert; backfill cũ = NULL.
  createdBy: uuid("created_by")
    .references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  companyIdIdx: index("agents_company_id_idx").on(t.companyId),
}));

/* Pivot N:M user × agent. role per cặp quyết định quyền khi
   agent.config.isPrivate=true. Khi isPrivate=false (default), table này
   chỉ dùng cho UI ★ "my agents" + ưu tiên trong sidebar — RBAC fallback
   về company-role. */
export const agentMemberRole = pgEnum("agent_member_role", [
  "owner", "operator", "observer",
]);

export const agentMembers = pgTable("agent_members", {
  agentId: uuid("agent_id").notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: agentMemberRole("role").notNull().default("operator"),
  addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
  addedAt: timestamp("added_at").defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.agentId, t.userId] }),
  userIdx: index("agent_members_user_idx").on(t.userId),
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
  // kind: "chat" (mặc định) | "embedding" — phân biệt profile sinh
  // chat completion với profile sinh embedding cho Knowledge Base.
  kind: text("kind").notNull().default("chat"),
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
  // entity_id + record_id: link approval với record cụ thể (v4).
  entityId: uuid("entity_id"),
  recordId: uuid("record_id"),
  // patch: JSONB thay đổi pending — server apply khi approved.
  patch: jsonb("patch"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  decidedAt: timestamp("decided_at"),
}, (t) => ({
  companyIdIdx: index("approval_requests_company_id_idx").on(t.companyId),
  recordIdIdx: index("approval_requests_record_idx").on(t.recordId),
}));

/* Time-series data per record per field — cho field type "timeseries"
   (sensor, stock price, telemetry). Tách bảng riêng để index theo
   (record_id, field_name, ts DESC) tốt cho query range gần đây. */
export const entityRecordTimeseries = pgTable("entity_record_timeseries", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  recordId: uuid("record_id").notNull()
    .references(() => entityRecords.id, { onDelete: "cascade" }),
  fieldName: text("field_name").notNull(),
  ts: timestamp("ts").defaultNow().notNull(),
  value: doublePrecision("value").notNull(),
  meta: jsonb("meta"),
}, (t) => ({
  recordFieldTsIdx: index("ert_record_field_ts_idx").on(t.recordId, t.fieldName, t.ts),
  tsIdx: index("ert_ts_idx").on(t.ts),
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

/* ─── Knowledge Base (RAG) ────────────────────────────────────
   Nguồn tri thức (file tải lên / dữ liệu entity / văn bản dán tay)
   được trích văn bản, cắt đoạn (chunk) rồi sinh embedding. Tra cứu
   bằng ANN cosine trên cột vector — phục vụ ô tìm kiếm UI lẫn tool
   "knowledge_search" của agent. Cần extension pgvector (migration
   0007 bật `CREATE EXTENSION vector`). */
export const knowledgeSources = pgTable("knowledge_sources", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  // kind: "file" | "entity" | "text"
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  // status: "pending" | "processing" | "ready" | "error"
  status: text("status").notNull().default("pending"),
  // meta: file → { path, mime, size, originalName }; entity → { entityId };
  //       text → { text }
  meta: jsonb("meta").notNull().default(sql`'{}'::jsonb`),
  error: text("error"),
  chunkCount: integer("chunk_count").notNull().default(0),
  // reindex_cron: biểu thức cron để tự nạp lại (chỉ nguồn kind=entity).
  // null = tắt. Scheduler quét cột này — xem jobs.ts.
  reindexCron: text("reindex_cron"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  companyIdIdx: index("knowledge_sources_company_id_idx").on(t.companyId),
}));

/* Đoạn (chunk) có embedding. Cột embedding vector(768) — index HNSW
   cosine tạo trong migration 0007 (drizzle-kit không sinh kiểu index
   này nên viết tay). */
export const knowledgeChunks = pgTable("knowledge_chunks", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id").notNull()
    .references(() => knowledgeSources.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  content: text("content").notNull(),
  tokens: integer("tokens").notNull().default(0),
  embedding: vector("embedding", { dimensions: 768 }),
}, (t) => ({
  companyIdIdx: index("knowledge_chunks_company_id_idx").on(t.companyId),
  sourceIdIdx: index("knowledge_chunks_source_id_idx").on(t.sourceId),
}));

/* ─── IoT — thiết bị gửi/nhận dữ liệu ───────────────────── */
/* Registry thiết bị: device_key_hash = SHA-256 hex của device key
   (key chỉ hiện 1 lần khi tạo). Multi-tenant qua company_id. */
export const iotDevices = pgTable("iot_devices", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  label: text("label"),
  deviceKeyHash: text("device_key_hash").notNull(),
  meta: jsonb("meta").notNull().default(sql`'{}'::jsonb`),
  lastSeenAt: timestamp("last_seen_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  keyHashIdx: uniqueIndex("iot_devices_key_hash_idx").on(t.deviceKeyHash),
  companyIdx: index("iot_devices_company_idx").on(t.companyId),
}));

/* Telemetry stream — append-only. Mỗi bản ghi là một mẫu thiết bị
   gửi lên (sensor reading, event, log…). Channel là "topic" mềm để
   phân loại (vd "temperature", "door", "alert"). */
export const iotTelemetry = pgTable("iot_telemetry", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  deviceId: uuid("device_id").notNull()
    .references(() => iotDevices.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  payload: jsonb("payload").notNull(),
  ts: timestamp("ts").defaultNow().notNull(),
}, (t) => ({
  deviceTsIdx: index("iot_telemetry_device_ts_idx").on(t.deviceId, t.ts),
  companyTsIdx: index("iot_telemetry_company_ts_idx").on(t.companyId, t.ts),
}));

/* Hàng đợi lệnh server → thiết bị. status: pending → sent → ack/error.
   Device pull qua GET /iot/v1/commands hoặc nhận push qua MQTT. */
export const iotCommands = pgTable("iot_commands", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  deviceId: uuid("device_id").notNull()
    .references(() => iotDevices.id, { onDelete: "cascade" }),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("pending"),
  result: jsonb("result"),
  sentAt: timestamp("sent_at"),
  ackedAt: timestamp("acked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  deviceStatusIdx: index("iot_commands_device_status_idx")
    .on(t.deviceId, t.status),
}));

/* ─── Backup — sao lưu lên Google Drive (UI/cron) ───────── */
/* Mỗi công ty 1 cấu hình. gdriveKeyEnc = JSON service account key đã
   mã hoá AES-256-GCM. scheduleCron NULL = chỉ chạy thủ công. */
export const backupConfig = pgTable("backup_config", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  gdriveKeyEnc: text("gdrive_key_enc").notNull(),
  gdriveFolderId: text("gdrive_folder_id").notNull(),
  scheduleCron: text("schedule_cron"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  companyUidx: uniqueIndex("backup_config_company_uidx").on(t.companyId),
}));

/* Lịch sử các lần backup. status: running → done | error. */
export const backupRuns = pgTable("backup_runs", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("running"),
  trigger: text("trigger").notNull().default("manual"),
  dbDriveFileId: text("db_drive_file_id"),
  dbBytes: integer("db_bytes"),
  uploadsSynced: integer("uploads_synced").notNull().default(0),
  uploadsSkipped: integer("uploads_skipped").notNull().default(0),
  uploadsBytes: integer("uploads_bytes").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
}, (t) => ({
  companyStartedIdx: index("backup_runs_company_started_idx")
    .on(t.companyId, t.startedAt),
}));

/* API keys per company — auth cho REST /api/v1/* endpoints. key_hash =
   sha256 của plaintext (sk_...); plaintext chỉ trả 1 lần lúc tạo. scopes
   JSONB array vd ["entity:customer:read"]; empty = full access.
   client_id (v4 OAuth): cho client_credentials flow — POST /oauth/token. */
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  keyHash: text("key_hash").notNull(),
  prefix: text("prefix").notNull(),
  scopes: jsonb("scopes").notNull().default(sql`'[]'::jsonb`),
  clientId: text("client_id"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  lastUsedAt: timestamp("last_used_at"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  hashIdx: uniqueIndex("api_keys_hash_idx").on(t.keyHash),
  clientIdx: uniqueIndex("api_keys_client_id_idx").on(t.clientId),
  companyIdx: index("api_keys_company_idx").on(t.companyId),
}));

/* Materialized views per company — pre-computed heavy aggregation cho
   dashboard/report. Query SQL custom (admin viết); refresh cron schedule
   ghi data JSONB. Render từ data field — nhanh hơn re-execute query. */

/* OAuth refresh tokens — long-lived; rotate khi dùng (issue new + revoke cũ).
   Token plaintext "rt_<hex>" → sha256 → token_hash. */
export const oauthRefreshTokens = pgTable("oauth_refresh_tokens", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  apiKeyId: uuid("api_key_id").notNull()
    .references(() => apiKeys.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tokenHashIdx: uniqueIndex("ort_token_hash_idx").on(t.tokenHash),
}));

/* OAuth authorization codes — short-lived (10 phút), PKCE bắt buộc.
   code_challenge = sha256(verifier) base64url. Method "S256" only. */
export const oauthAuthCodes = pgTable("oauth_auth_codes", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  codeHash: text("code_hash").notNull(),
  clientId: text("client_id").notNull(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  apiKeyId: uuid("api_key_id").notNull()
    .references(() => apiKeys.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  codeChallengeMethod: text("code_challenge_method").notNull().default("S256"),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  codeHashIdx: uniqueIndex("oac_code_hash_idx").on(t.codeHash),
}));

export const entityMaterializedViews = pgTable("entity_materialized_views", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  label: text("label").notNull(),
  sqlQuery: text("sql_query").notNull(),
  scheduleCron: text("schedule_cron"),
  data: jsonb("data"),
  rowCount: integer("row_count"),
  lastRefreshedAt: timestamp("last_refreshed_at"),
  lastError: text("last_error"),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  companyNameIdx: uniqueIndex("emv_company_name_idx").on(t.companyId, t.name),
}));

/* Saved views per entity per user — mỗi view lưu query + columns config.
   is_default = entity mở mặc định load view này. Không enforce unique tên
   để user tự đặt tự do. */
export const savedViews = pgTable("saved_views", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  entityId: uuid("entity_id").notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  query: jsonb("query").notNull().default(sql`'{}'::jsonb`),
  columns: jsonb("columns"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  entityIdx: index("saved_views_entity_idx").on(t.entityId),
  userEntityIdx: index("saved_views_user_entity_idx").on(t.createdBy, t.entityId),
}));

/* Counter atomic cho field type "sequence" — sinh chuỗi tăng dần per
   (company, entity, field). Server SELECT FOR UPDATE + INCREMENT khi
   records.create để không trùng. */
export const entitySequences = pgTable("entity_sequences", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  entityName: text("entity_name").notNull(),
  fieldKey: text("field_key").notNull(),
  nextValue: integer("next_value").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  uidx: uniqueIndex("entity_sequences_uidx")
    .on(t.companyId, t.entityName, t.fieldKey),
}));

/* Reusable enum (option set) — tái sử dụng giữa nhiều entity field, có
   nhãn đa ngôn ngữ (vi/en). values JSONB:
     Array<{ value: string, label: string, labelEn?: string }>.
   Field type "enum"/"multi-enum" tham chiếu qua enum_id. */
export const enums = pgTable("enums", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  label: text("label").notNull(),
  labelEn: text("label_en"),
  description: text("description"),
  values: jsonb("values").notNull().default(sql`'[]'::jsonb`),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  companyNameIdx: uniqueIndex("enums_company_name_idx")
    .on(t.companyId, t.name),
}));

/* Native procedure registry: JS procedure đăng ký runtime, chạy server
   qua isolated-vm với db/entity bindings. Thay dần stored proc MSSQL. */
export const procedures = pgTable("procedures", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  label: text("label").notNull(),
  description: text("description"),
  paramsSchema: jsonb("params_schema").notNull().default(sql`'[]'::jsonb`),
  returnSchema: jsonb("return_schema"),
  code: text("code").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  companyNameIdx: uniqueIndex("procedures_company_name_idx")
    .on(t.companyId, t.name),
}));

/* ─── Tools — artifact ngoài monorepo (D:\code\cowok\Tools\*) ──
   Khác plugin (in-process TS module): tool là ứng dụng độc lập có
   manifest (paperclip.manifest.json + erp.tool.json override),
   discover qua TOOLS_DIR auto-scan hoặc đăng ký URL remote.
   `tools` global; `company_tools` cho per-tenant enable/config. */
export const tools = pgTable("tools", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  slug: text("slug").notNull(),           // = manifest.id; globally unique
  name: text("name").notNull(),
  displayName: text("display_name"),
  kind: text("kind").notNull(),           // web-app | mcp-server | cli | plugin
  runtime: text("runtime").notNull(),     // embedded | spawn | remote
  manifest: jsonb("manifest").notNull(),  // ToolManifest đã merge
  source: jsonb("source").notNull(),      // {kind:local,path,overridePath} | {kind:remote,manifestUrl}
  enabledGlobal: boolean("enabled_global").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  slugUidx: uniqueIndex("tools_slug_uidx").on(t.slug),
}));

export const companyTools = pgTable("company_tools", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  toolId: uuid("tool_id").notNull()
    .references(() => tools.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  /* Per-tenant config: token API, endpoint override, runtime port cache… */
  config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  companyToolUidx: uniqueIndex("company_tools_company_tool_uidx")
    .on(t.companyId, t.toolId),
}));

/* Mapping file local → file Drive. Tránh quét Drive mỗi lần sync. */
export const uploadSyncState = pgTable("upload_sync_state", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id").notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  relPath: text("rel_path").notNull(),
  driveFileId: text("drive_file_id").notNull(),
  size: integer("size").notNull(),
  mtime: timestamp("mtime").notNull(),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
}, (t) => ({
  companyPathUidx: uniqueIndex("upload_sync_state_company_path_uidx")
    .on(t.companyId, t.relPath),
}));
