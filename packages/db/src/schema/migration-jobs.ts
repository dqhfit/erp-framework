import { sql } from "drizzle-orm";
import {
  bigint,
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
import { entities } from "./entities";
import { mssqlConnections } from "./legacy";
import { companies } from "./tenant";

export const migrationFullJobs = pgTable(
  "migration_full_jobs",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => mssqlConnections.id, { onDelete: "restrict" }),
    kind: text("kind").default("full").notNull(),
    status: text("status").default("queued").notNull(),
    // {items: [{tableName, entityName, label, fields[]}], batchSize, writeManifest}
    config: jsonb("config").default(sql`'{}'::jsonb`).notNull(),
    totalTables: integer("total_tables").default(0).notNull(),
    completedTables: integer("completed_tables").default(0).notNull(),
    totalRowsImported: bigint("total_rows_imported", { mode: "number" }).default(0).notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    lastHeartbeat: timestamp("last_heartbeat").defaultNow().notNull(),
    // Lease chống 2 worker chạy CÙNG job (rolling deploy: boot mới re-enqueue
    // job 'running' khi worker container cũ còn sống → cả 2 stream song song
    // từ lastPk RAM riêng → insert trùng hàng loạt). Worker claim bằng token
    // mới; heartbeat per-batch có điều kiện worker_token=token — mất lease là
    // dừng ngay.
    workerToken: uuid("worker_token"),
    error: text("error"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyStatusIdx: index("migration_full_jobs_company_status_idx").on(t.companyId, t.status),
  }),
);

/** Phase U — Per-table state cho full import job. Lưu lastPk để resume
 *  + sync. pkColumn detect tự động từ MSSQL primary key (single col). */
export const migrationFullJobTables = pgTable(
  "migration_full_job_tables",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => migrationFullJobs.id, { onDelete: "cascade" }),
    tableName: text("table_name").notNull(),
    entityId: uuid("entity_id").references(() => entities.id, { onDelete: "set null" }),
    entityName: text("entity_name").notNull(),
    pkColumn: text("pk_column"),
    lastPk: text("last_pk"),
    rowsImported: bigint("rows_imported", { mode: "number" }).default(0).notNull(),
    batchSize: integer("batch_size").default(5000).notNull(),
    status: text("status").default("pending").notNull(),
    error: text("error"),
    // So lan worker bat dau (running) bang nay. Cap resume: bang khong tien duoc
    // (rows_imported=0) qua nguong MAX_TABLE_ATTEMPTS -> tu dong skipped (mig 0076).
    attempts: integer("attempts").default(0).notNull(),
    // Reconciliation sau import: so COUNT nguon (MSSQL) vs dich (entity_records).
    // reconcile: null=chua check | 'ok'=khop | 'drift'=lech | 'skip'=khong check.
    srcCount: bigint("src_count", { mode: "number" }),
    tgtCount: bigint("tgt_count", { mode: "number" }),
    reconcile: text("reconcile"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    jobStatusIdx: index("migration_full_job_tables_job_status_idx").on(t.jobId, t.status),
  }),
);

/** Action job durable — discover/enrich/generate/data chạy qua pg-boss
 *  queue "migration-run". State lưu DB (KHÔNG chỉ in-memory) để:
 *   - Sống sót server restart (pg-boss giao lại job → worker đọc row này).
 *   - Resume khi lỗi: re-enqueue cùng args (action idempotent: skipExisting/
 *     skipEnriched/merge → bỏ qua phần đã xong).
 *  full-import KHÔNG dùng bảng này (đã có migration_full_jobs riêng). */
export const migrationJobs = pgTable(
  "migration_jobs",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(), // discover|enrich|capture-golden|generate|data
    module: text("module").notNull(),
    args: jsonb("args").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("queued"), // queued|running|completed|failed|canceled
    attempts: integer("attempts").notNull().default(0),
    message: text("message"),
    error: text("error"),
    // Token tich luy qua cac lan resume — de --max-cost-usd la tran THAT cho ca
    // job (truoc day cost reset 0 moi resume → tieu 5 USD x N lan). enrich doc
    // lam baseline + ghi lai sau moi run.
    tokensIn: bigint("tokens_in", { mode: "number" }).notNull().default(0),
    tokensOut: bigint("tokens_out", { mode: "number" }).notNull().default(0),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    durationMs: integer("duration_ms"),
    lastHeartbeat: timestamp("last_heartbeat").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyStatusIdx: index("migration_jobs_company_status_idx").on(t.companyId, t.status),
  }),
);

export const llmProfiles = pgTable(
  "llm_profiles",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // userId: NULL = profile CHUNG công ty (admin quản lý, vào RBAC settings);
    // có giá trị = profile CÁ NHÂN của user đó (mỗi tài khoản tự cấu hình model
    // riêng). Resolve: ưu tiên cá nhân → fallback công ty.
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    adapter: text("adapter").notNull(),
    model: text("model").notNull(),
    // kind: "chat" (mặc định) | "embedding" — phân biệt profile sinh
    // chat completion với profile sinh embedding cho Knowledge Base.
    kind: text("kind").notNull().default("chat"),
    // runtime: "server" = server tự gọi (API/bridge server với tới được);
    // "browser" = model LOCAL trên máy user — chỉ client-side gọi được, server
    // bỏ qua (fallback công ty). Profile công ty luôn "server".
    runtime: text("runtime").notNull().default("server"),
    endpoint: text("endpoint"),
    apiKeyEnc: text("api_key_enc"), // mã hoá ở tầng app, không plaintext
    temperature: doublePrecision("temperature").default(0.7),
    maxTokens: integer("max_tokens").default(4096),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    // Profile công ty (user_id NULL): unique theo (company, name).
    companyNameIdx: uniqueIndex("llm_profiles_company_name_idx")
      .on(t.companyId, t.name)
      .where(sql`${t.userId} IS NULL`),
    // Profile cá nhân: unique theo (company, user, name).
    companyUserNameIdx: uniqueIndex("llm_profiles_company_user_name_idx")
      .on(t.companyId, t.userId, t.name)
      .where(sql`${t.userId} IS NOT NULL`),
  }),
);
