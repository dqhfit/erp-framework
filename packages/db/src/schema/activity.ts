import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
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
import { users } from "./auth";
import { approvalStatus, runStatus } from "./enums";
import { companies } from "./tenant";
import { agents, workflows } from "./workflows";

/* ─── Vận hành: nhật ký, lịch, lần chạy ──────────────────── */
export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
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
  },
  (t) => ({
    atIdx: index("activity_log_at_idx").on(t.at),
    companyIdIdx: index("activity_log_company_id_idx").on(t.companyId),
  }),
);

export const schedules = pgTable("schedules", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  workflowId: uuid("workflow_id")
    .notNull()
    .references(() => workflows.id, { onDelete: "cascade" }),
  cronExpr: text("cron_expr").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastRun: timestamp("last_run"),
  lastStatus: runStatus("last_status"),
  runCount: integer("run_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    scheduleId: uuid("schedule_id").references(() => schedules.id, { onDelete: "set null" }),
    status: runStatus("status").notNull().default("running"),
    steps: jsonb("steps").notNull().default(sql`'[]'::jsonb`),
    vars: jsonb("vars").notNull().default(sql`'{}'::jsonb`),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => ({
    workflowIdIdx: index("workflow_runs_workflow_id_idx").on(t.workflowId),
  }),
);

/* ─── Guardrails — bài học từ node fail lặp lại (Loops!-style) ───
   Khi một node trong workflow fail lặp cùng lỗi (gom theo fingerprint),
   ghi nhận + đếm; chạm ngưỡng → sinh "lesson" (LLM, fail-safe) để tự
   chèn vào system prompt các lần chạy sau, tránh lặp lỗi. Tương tự
   .ralph/guardrails.md nhưng multi-tenant, gắn theo workflow + node. */
export const workflowGuardrails = pgTable(
  "workflow_guardrails",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    // nodeId: id node trong graph gặp lỗi (định danh chỗ lỗi).
    nodeId: text("node_id").notNull(),
    // fingerprint: SHA-256 rút gọn của thông điệp lỗi (gom trùng — như client_errors).
    fingerprint: text("fingerprint").notNull(),
    // errorSample: thông điệp lỗi gốc (cắt ngắn) để người/LLM hiểu ngữ cảnh.
    errorSample: text("error_sample").notNull(),
    failCount: integer("fail_count").notNull().default(1),
    // lesson: bài học chèn vào prompt; null = chưa có (LLM lỗi hoặc chờ người viết).
    lesson: text("lesson"),
    // status: active = đang áp dụng/chèn; archived = đã xử lý, không chèn nữa.
    status: text("status").notNull().default("active"),
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    thresholdMetAt: timestamp("threshold_met_at"),
    updatedBy: uuid("updated_by").references((): AnyPgColumn => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    uk: uniqueIndex("workflow_guardrails_uk").on(
      t.companyId,
      t.workflowId,
      t.nodeId,
      t.fingerprint,
    ),
    listIdx: index("workflow_guardrails_list_idx").on(t.companyId, t.workflowId, t.status),
  }),
);

/* ─── Heartbeat — agent tự thức dậy theo lịch & hành động ─── */
export const agentHeartbeats = pgTable(
  "agent_heartbeats",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    cronExpr: text("cron_expr").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    // prompt: chỉ dẫn agent thực hiện mỗi nhịp (vd "tổng hợp đơn hàng mới").
    prompt: text("prompt").notNull(),
    lastRun: timestamp("last_run"),
    lastStatus: runStatus("last_status"),
    lastSummary: text("last_summary"), // tóm tắt kết quả nhịp gần nhất
    runCount: integer("run_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    companyIdIdx: index("agent_heartbeats_company_id_idx").on(t.companyId),
    agentIdIdx: index("agent_heartbeats_agent_id_idx").on(t.agentId),
  }),
);

/* ─── Governance — yêu cầu phê duyệt nhiều tầng ──────────── */

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
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
  },
  (t) => ({
    companyIdIdx: index("approval_requests_company_id_idx").on(t.companyId),
    recordIdIdx: index("approval_requests_record_idx").on(t.recordId),
  }),
);

/* Time-series data per record per field — cho field type "timeseries"
   (sensor, stock price, telemetry). Tách bảng riêng để index theo
   (record_id, field_name, ts DESC) tốt cho query range gần đây. */
