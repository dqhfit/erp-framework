import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
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

/* ─── Delta-sync MSSQL → PG (chạy song song + cutover) ──────
   3 bảng state cho engine đồng bộ liên tục:
   - migration_sync_tables: per-bảng config + CT watermark + counters
   - migration_sync_modules: per-module cron config + heartbeat lock
   - migration_sync_runs: lịch sử chu kỳ (debug + chart lag)      */

export const migrationSyncTables = pgTable(
  "migration_sync_tables",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => mssqlConnections.id, { onDelete: "cascade" }),
    module: text("module").notNull(),
    tableName: text("table_name").notNull(),
    entityId: uuid("entity_id").references(() => entities.id, { onDelete: "set null" }),
    pkColumn: text("pk_column"),
    // mode: ct | rescan | manual
    mode: text("mode").notNull().default("ct"),
    enabled: boolean("enabled").notNull().default(true),
    // status: idle | seeding | running | error | reseed_required | cutover
    status: text("status").notNull().default("idle"),
    ctLastVersion: bigint("ct_last_version", { mode: "number" }),
    srcCurrentVersion: bigint("src_current_version", { mode: "number" }),
    pendingChanges: integer("pending_changes"),
    insertsCount: bigint("inserts_count", { mode: "number" }).notNull().default(0),
    updatesCount: bigint("updates_count", { mode: "number" }).notNull().default(0),
    deletesCount: bigint("deletes_count", { mode: "number" }).notNull().default(0),
    lastSyncedAt: timestamp("last_synced_at"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyModuleIdx: index("migration_sync_tables_company_module_idx").on(t.companyId, t.module),
  }),
);

export const migrationSyncModules = pgTable(
  "migration_sync_modules",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => mssqlConnections.id, { onDelete: "cascade" }),
    module: text("module").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    cronExpr: text("cron_expr").notNull().default("*/5 * * * *"),
    // User bật sync — cron tick dùng làm created_by khi insert row mới
    // (cần uuid thật; chuỗi "system" vỡ cast ::uuid).
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    // heartbeatAt: NULL = không có job đang chạy; có giá trị = đang chạy (lock).
    // Stale sau 10 phút (process crash) → cho phép job mới claim lock.
    heartbeatAt: timestamp("heartbeat_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyModuleUidx: uniqueIndex("migration_sync_modules_company_module_uq_idx").on(
      t.companyId,
      t.connectionId,
      t.module,
    ),
  }),
);

export const migrationSyncRuns = pgTable(
  "migration_sync_runs",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => mssqlConnections.id, { onDelete: "cascade" }),
    module: text("module").notNull(),
    tableName: text("table_name"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
    durationMs: integer("duration_ms"),
    inserts: integer("inserts").notNull().default(0),
    updates: integer("updates").notNull().default(0),
    deletes: integer("deletes").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    companyModuleIdx: index("migration_sync_runs_company_module_idx").on(
      t.companyId,
      t.module,
      t.startedAt,
    ),
  }),
);

/** Báo cáo hiện diện v1 (dùng song song với v2 chitiet). */
export const mesBaoCaoHienDien = pgTable(
  "mes_baocao_hien_dien",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    maCongDoan: text("ma_cong_doan").notNull(),
    ngaythang: date("ngaythang", { mode: "date" }).notNull(),
    soNguoiHc: integer("so_nguoi_hc").notNull().default(0),
    soNguoiTc: integer("so_nguoi_tc").notNull().default(0),
    nguoiTao: text("nguoi_tao").notNull().default(""),
    ngayTao: timestamp("ngay_tao").defaultNow().notNull(),
    nguoiSua: text("nguoi_sua").notNull().default(""),
    ngaySua: timestamp("ngay_sua").defaultNow().notNull(),
  },
  (t) => ({
    uk: uniqueIndex("mes_baocao_hien_dien_uk").on(t.companyId, t.maCongDoan, t.ngaythang),
  }),
);
