import { sql } from "drizzle-orm";
import {
  boolean,
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
import { companies } from "./tenant";

export const entityMaterializedViews = pgTable(
  "entity_materialized_views",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
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
  },
  (t) => ({
    companyNameIdx: uniqueIndex("emv_company_name_idx").on(t.companyId, t.name),
  }),
);

/* Saved views per entity per user — mỗi view lưu query + columns config.
   is_default = entity mở mặc định load view này. Không enforce unique tên
   để user tự đặt tự do. */
export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    query: jsonb("query").notNull().default(sql`'{}'::jsonb`),
    columns: jsonb("columns"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    entityIdx: index("saved_views_entity_idx").on(t.entityId),
    userEntityIdx: index("saved_views_user_entity_idx").on(t.createdBy, t.entityId),
  }),
);

/* Counter atomic cho field type "sequence" — sinh chuỗi tăng dần per
   (company, entity, field). Server SELECT FOR UPDATE + INCREMENT khi
   records.create để không trùng. */
export const entitySequences = pgTable(
  "entity_sequences",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    entityName: text("entity_name").notNull(),
    fieldKey: text("field_key").notNull(),
    nextValue: integer("next_value").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    uidx: uniqueIndex("entity_sequences_uidx").on(t.companyId, t.entityName, t.fieldKey),
  }),
);

/* Reusable enum (option set) — tái sử dụng giữa nhiều entity field, có
   nhãn đa ngôn ngữ (vi/en). values JSONB:
     Array<{ value: string, label: string, labelEn?: string }>.
   Field type "enum"/"multi-enum" tham chiếu qua enum_id. */
export const enums = pgTable(
  "enums",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
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
  },
  (t) => ({
    companyNameIdx: uniqueIndex("enums_company_name_idx").on(t.companyId, t.name),
  }),
);

/* Native procedure registry: JS procedure đăng ký runtime, chạy server
   qua isolated-vm với db/entity bindings. Thay dần stored proc MSSQL. */
export const procedures = pgTable(
  "procedures",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    paramsSchema: jsonb("params_schema").notNull().default(sql`'[]'::jsonb`),
    returnSchema: jsonb("return_schema"),
    code: text("code").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    // meta: nguồn gốc + dữ liệu phụ. Khi proc sinh ra từ migrate stored
    // proc MSSQL → meta.source = { kind:'migration', sourceProc, module,
    // tier, migratedAt, migratedBy } — cho phép truy ngược proc mới về
    // proc MSSQL cũ (đối xứng với entities.meta.source).
    meta: jsonb("meta").notNull().default(sql`'{}'::jsonb`),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyNameIdx: uniqueIndex("procedures_company_name_idx").on(t.companyId, t.name),
  }),
);

/* ─── Tools — artifact ngoài monorepo (D:\code\cowok\Tools\*) ──
   Khác plugin (in-process TS module): tool là ứng dụng độc lập có
   manifest (paperclip.manifest.json + erp.tool.json override),
   discover qua TOOLS_DIR auto-scan hoặc đăng ký URL remote.
   `tools` global; `company_tools` cho per-tenant enable/config. */
export const tools = pgTable(
  "tools",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    slug: text("slug").notNull(), // = manifest.id; globally unique
    name: text("name").notNull(),
    displayName: text("display_name"),
    kind: text("kind").notNull(), // web-app | mcp-server | cli | plugin
    runtime: text("runtime").notNull(), // embedded | spawn | remote
    manifest: jsonb("manifest").notNull(), // ToolManifest đã merge
    source: jsonb("source").notNull(), // {kind:local,path,overridePath} | {kind:remote,manifestUrl}
    enabledGlobal: boolean("enabled_global").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    slugUidx: uniqueIndex("tools_slug_uidx").on(t.slug),
  }),
);

export const companyTools = pgTable(
  "company_tools",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    toolId: uuid("tool_id")
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    /* Per-tenant config: token API, endpoint override, runtime port cache… */
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyToolUidx: uniqueIndex("company_tools_company_tool_uidx").on(t.companyId, t.toolId),
  }),
);

/* Mapping file local → file Drive. Tránh quét Drive mỗi lần sync. */
export const uploadSyncState = pgTable(
  "upload_sync_state",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    relPath: text("rel_path").notNull(),
    driveFileId: text("drive_file_id").notNull(),
    size: integer("size").notNull(),
    mtime: timestamp("mtime").notNull(),
    syncedAt: timestamp("synced_at").defaultNow().notNull(),
  },
  (t) => ({
    companyPathUidx: uniqueIndex("upload_sync_state_company_path_uidx").on(t.companyId, t.relPath),
  }),
);
