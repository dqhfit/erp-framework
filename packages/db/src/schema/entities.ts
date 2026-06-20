import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { companies } from "./tenant";

/* ─── Metadata low-code (định nghĩa do designer tạo) ─────── */
export const entities = pgTable(
  "entities",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // định danh máy: "so_don_hang"
    label: text("label").notNull(), // nhãn hiển thị
    icon: text("icon"),
    fields: jsonb("fields").notNull().default(sql`'[]'::jsonb`),
    // meta: dữ liệu phụ tầng app không thuộc cột typed — vd { mcp, mcpBindings }.
    meta: jsonb("meta").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // Unique tên CASE-INSENSITIVE trong công ty (lower(name)) — chống trùng
    // "Order" vs "order" + race. Xem migration 0052.
    companyNameIdx: uniqueIndex("entities_company_name_idx").on(t.companyId, sql`lower(${t.name})`),
  }),
);

/* Nguồn dữ liệu (DataSource) — đối tượng hạng nhất kiểu ORM: gộp field từ
   nhiều entity liên quan (join qua lookup) thành 1 bảng phẳng, đọc+ghi, gán
   cho widget. config (jsonb) chứa DataSourceConfig (xem core/datasource/config).
   KHÔNG có bảng dữ liệu riêng — đọc/ghi xuyên qua entity_records của các entity
   nguồn (base + relation). Mirror cấu trúc entities. */
export const dataSources = pgTable(
  "datasources",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // định danh máy: "don_hang_kem_khach"
    label: text("label").notNull(), // nhãn hiển thị
    icon: text("icon"),
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyNameIdx: uniqueIndex("datasources_company_name_idx").on(
      t.companyId,
      sql`lower(${t.name})`,
    ),
    companyIdx: index("datasources_company_idx").on(t.companyId),
  }),
);

/* Dữ liệu thực tế của entity động — JSONB. Index: btree(entityId)
   + GIN(data) riêng; index khoảng/sort viết SQL thô trong migration.
   - deletedAt: soft delete; null = active, ts = đã xoá nhưng còn restore được.
   - version: optimistic lock counter — caller update phải gửi expectedVersion. */
export const entityRecords = pgTable(
  "entity_records",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
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
  },
  (t) => ({
    entityIdIdx: index("entity_records_entity_id_idx").on(t.entityId),
    companyIdIdx: index("entity_records_company_id_idx").on(t.companyId),
    deletedAtIdx: index("entity_records_deleted_at_idx").on(t.deletedAt),
    dataGinIdx: index("entity_records_data_gin_idx").using("gin", sql`${t.data} jsonb_path_ops`),
  }),
);

/* Locator record->entity cho lưu trữ HYBRID (Phase 1). CHỈ chứa record của
   entity tier='table' (sống ở bảng er_<entityId>, KHÔNG ở entity_records).
   Cho phép thao tác chỉ có recordId (get/update/delete) định tuyến đúng bảng.
   Xem memory project_hybrid_storage_migration. */
export const recordLocator = pgTable(
  "record_locator",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
  },
  (t) => ({
    companyIdx: index("record_locator_company_idx").on(t.companyId),
  }),
);

/* Embedding semantic search per record — gom field marked embedSearchable
   thành 1 chuỗi → embed → index. 768 chiều cho nomic-embed-text. */
export const entityRecordEmbeddings = pgTable(
  "entity_record_embeddings",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // FK record_id -> entity_records.id BỎ ở migration 0071 (HYBRID Phase 4b):
    // record entity tier='table' sống ở er_<id>, không ở entity_records; company_id
    // FK giữ nguyên nên xoá công ty vẫn cascade dọn. Xem docs/HYBRID-STORAGE.md.
    recordId: uuid("record_id").notNull(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    embedding: vector("embedding", { dimensions: 768 }).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    recordUidx: uniqueIndex("ere_record_uidx").on(t.recordId),
    entityIdx: index("ere_entity_idx").on(t.entityId),
  }),
);

/* Comments per record + nested replies (parent_id self-ref). Soft delete. */
export const recordComments = pgTable(
  "record_comments",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    recordId: uuid("record_id").notNull(),
    parentId: uuid("parent_id"),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => ({
    recordIdx: index("record_comments_record_idx").on(t.recordId),
    parentIdx: index("record_comments_parent_idx").on(t.parentId),
  }),
);

/* Real-time co-edit ops log per (record, field). seq = op sequence
   monotonic; base_seq = client's known seq lúc gửi op (transform nếu
   base_seq < server seq). op = "insert" | "delete". */
export const recordFieldOps = pgTable(
  "record_field_ops",
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
    seq: integer("seq").notNull(),
    baseSeq: integer("base_seq").notNull(),
    op: text("op").notNull(),
    pos: integer("pos").notNull(),
    chars: text("chars"),
    length: integer("length"),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    recordFieldSeqIdx: uniqueIndex("rfo_record_field_seq_idx").on(t.recordId, t.fieldName, t.seq),
  }),
);

/* In-app notifications — mention / comment / webhook_failure / system.
   read_at NULL = chưa đọc. user_id = recipient; actor_user_id = ai gây ra. */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    targetRecordId: uuid("target_record_id"),
    targetUrl: text("target_url"),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("notifications_user_idx").on(t.userId, t.readAt),
    recordIdx: index("notifications_record_idx").on(t.targetRecordId),
  }),
);

/* Presence "đang xem" per record per user — UPSERT mỗi ping client. */
export const recordPresence = pgTable(
  "record_presence",
  {
    // FK record_id -> entity_records.id BỎ ở migration 0071 (HYBRID Phase 4b):
    // record entity tier='table' sống ở er_<id>, không ở entity_records; company_id
    // FK giữ nguyên nên xoá công ty vẫn cascade dọn. Xem docs/HYBRID-STORAGE.md.
    recordId: uuid("record_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    lastSeen: timestamp("last_seen").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.recordId, t.userId] }),
    lastSeenIdx: index("rp_last_seen_idx").on(t.lastSeen),
  }),
);

/* Encryption key rotation registry — active key dùng để encrypt mới;
   decrypt thử mọi key theo created_at DESC. key_material null trong
   production (key thật ở KMS / env / vault). */
export const encryptionKeys = pgTable(
  "encryption_keys",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    kid: text("kid").notNull(),
    keyHash: text("key_hash").notNull(),
    keyMaterial: text("key_material"),
    active: boolean("active").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    rotatedAt: timestamp("rotated_at"),
  },
  (t) => ({
    kidIdx: uniqueIndex("encryption_keys_kid_idx").on(t.kid),
  }),
);

/* Workflow versioning + A/B testing — mỗi publish snapshot graph vào
   row mới. weight % cho A/B test split, nhiều version active song song. */
export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id").notNull(),
    version: integer("version").notNull(),
    label: text("label").notNull().default("v1"),
    graph: jsonb("graph").notNull(),
    weight: integer("weight").notNull().default(100),
    active: boolean("active").notNull().default(true),
    publishedBy: uuid("published_by").references(() => users.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at").defaultNow().notNull(),
  },
  (t) => ({
    workflowVersionIdx: uniqueIndex("wv_workflow_version_idx").on(t.workflowId, t.version),
    workflowActiveIdx: index("wv_workflow_active_idx").on(t.workflowId, t.active),
  }),
);

/* Templates print/email per entity — Mustache-like {{field}} substitution
   với record data. kind: "print" (HTML cho in/PDF) hoặc "email" (subject+body). */
export const entityTemplates = pgTable(
  "entity_templates",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    entityIdx: index("et_entity_idx").on(t.entityId, t.kind),
  }),
);

/* Outgoing webhooks per entity — fire-and-forget HTTP POST khi event
   create/update/delete. HMAC-SHA256 signature qua secret + body. */
export const entityWebhooks = pgTable(
  "entity_webhooks",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
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
  },
  (t) => ({
    entityIdx: index("entity_webhooks_entity_idx").on(t.entityId),
  }),
);

/* Lịch sử bản ghi entity — mỗi update tạo 1 row. Cho phép audit (ai,
   khi nào, đổi gì từ X→Y) + revert về version trước. */
export const entityRecordVersions = pgTable(
  "entity_record_versions",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // FK record_id -> entity_records.id BỎ ở migration 0071 (HYBRID Phase 4b):
    // record entity tier='table' sống ở er_<id>, không ở entity_records; company_id
    // FK giữ nguyên nên xoá công ty vẫn cascade dọn. Xem docs/HYBRID-STORAGE.md.
    recordId: uuid("record_id").notNull(),
    version: integer("version").notNull(),
    data: jsonb("data").notNull(),
    diff: jsonb("diff").notNull().default(sql`'{}'::jsonb`),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    recordIdIdx: index("entity_record_versions_record_id_idx").on(t.recordId),
    recordVersionIdx: index("entity_record_versions_record_version_idx").on(t.recordId, t.version),
  }),
);
