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

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

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
  primaryAgentId: uuid("primary_agent_id").references((): AnyPgColumn => agents.id, {
    onDelete: "set null",
  }),
  preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/* Invite token để admin mời user mới — user dùng link /invite?token=...
   để tự đặt mật khẩu lần đầu. Token random 32 byte base64url, dùng 1 lần.
   accepted_at != null = đã consume; expires_at < now = hết hạn. */
export const userInvites = pgTable(
  "user_invites",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references((): AnyPgColumn => companies.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    role: userRole("role").notNull().default("viewer"),
    invitedBy: uuid("invited_by").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    tokenIdx: uniqueIndex("user_invites_token_idx").on(t.token),
    userIdx: index("user_invites_user_idx").on(t.userId),
    companyIdx: index("user_invites_company_idx").on(t.companyId),
  }),
);

/* Generic invite link -- admin tao link, bat ky ai co link tu dang ky vao
   cong ty. Link dung 1 lan (used_at set sau khi nguoi dung accept). */
export const inviteLinks = pgTable(
  "invite_links",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references((): AnyPgColumn => companies.id, { onDelete: "cascade" }),
    role: userRole("role").notNull().default("viewer"),
    token: text("token").notNull(),
    createdBy: uuid("created_by").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    usedBy: uuid("used_by").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    tokenIdx: uniqueIndex("invite_links_token_idx").on(t.token),
    companyIdx: index("invite_links_company_idx").on(t.companyId),
  }),
);

/* ─── Đa công ty (multi-tenant) ─────────────────────────── */
export const companies = pgTable("companies", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(), // định danh URL-an-toàn
  // theme: white-labeling JSONB { primaryColor, logoUrl, productName, faviconUrl }.
  theme: jsonb("theme"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/* Tracking báo cáo audit export — ai/khi nào pull data compliance. */
export const auditReports = pgTable("audit_reports", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  fromDate: timestamp("from_date"),
  toDate: timestamp("to_date"),
  rowCount: integer("row_count"),
  requestedBy: uuid("requested_by").references((): AnyPgColumn => users.id, {
    onDelete: "set null",
  }),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
});

/* Thành viên công ty: user × company × role. Một user nhiều công ty. */
export const companyMembers = pgTable(
  "company_members",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: userRole("role").notNull().default("viewer"),
    /** false = dang ky qua generic invite link, cho admin duyet.
     true  = tat ca cac truong hop khac (mac dinh). */
    approved: boolean("approved").notNull().default(true),
    /** true = admin da vo hieu hoa tai khoan nay trong cong ty. */
    disabled: boolean("disabled").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    companyUserIdx: uniqueIndex("company_members_company_user_idx").on(t.companyId, t.userId),
    userIdx: index("company_members_user_id_idx").on(t.userId),
  }),
);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // token phiên ngẫu nhiên
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Công ty đang chọn của phiên. null = dùng công ty đầu tiên user là thành viên.
  activeCompanyId: uuid("active_company_id").references(() => companies.id, {
    onDelete: "set null",
  }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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

export const pages = pgTable(
  "pages",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    label: text("label").notNull(),
    icon: text("icon"),
    content: jsonb("content").notNull().default(sql`'{}'::jsonb`),
    published: boolean("published").notNull().default(false),
    publishMode: text("publish_mode").notNull().default("private"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyNameIdx: uniqueIndex("pages_company_name_idx").on(t.companyId, t.name),
  }),
);

/* nav_items — cau hinh menu/dieu huong per-company dang CAY. Admin dung trinh
   dung menu (Settings -> Navigation) de tu sap xep: nhom (group) chua page/link,
   keo-tha doi thu tu + cap cha. Render o Sidebar section "Menu".
   kind: group (thu muc, khong target) | page (target=pageId) | link (target=route/url).
   parentId self-ref (FK + cascade khai o migration 0065). */
export const navItems = pgTable(
  "nav_items",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => navItems.id, {
      onDelete: "cascade",
    }),
    kind: text("kind").notNull().default("group"),
    label: text("label").notNull(),
    icon: text("icon"),
    target: text("target"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyIdx: index("nav_items_company_idx").on(t.companyId),
    parentIdx: index("nav_items_parent_idx").on(t.parentId),
  }),
);

export const viewerGroups = pgTable("viewer_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6366f1"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const userViewerGroups = pgTable(
  "user_viewer_groups",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => viewerGroups.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.groupId] }) }),
);

export const pageViewerGroups = pgTable(
  "page_viewer_groups",
  {
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => viewerGroups.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.pageId, t.groupId] }) }),
);

export const workflowTrigger = pgEnum("workflow_trigger", [
  "manual",
  "webhook",
  "cron",
  "entity_changed",
  "iot_telemetry",
]);

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
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
  },
  (t) => ({
    companyIdIdx: index("workflows_company_id_idx").on(t.companyId),
  }),
);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    model: text("model").notNull(),
    // config.isPrivate (boolean, optional): true → ACL chặt theo resource_members
    // (resource_type='agent'); false/undefined → fallback về company-RBAC (mọi
    // editor đều edit OK). Xem packages/server/src/agent-acl.ts.
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    // managerId: agent cấp trên (org chart / phân cấp agent). null = cấp cao nhất.
    managerId: uuid("manager_id").references((): AnyPgColumn => agents.id, {
      onDelete: "set null",
    }),
    // createdBy: ai tạo agent — set khi insert; backfill cũ = NULL.
    createdBy: uuid("created_by").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyIdIdx: index("agents_company_id_idx").on(t.companyId),
  }),
);

/* agent_members + agent_member_role: DROP ở migration 0045 sau khi
   resource_members (P2.3) trở thành nguồn sự thật. Mọi đọc/ghi đã
   migrate sang resource_members qua resource-acl.ts. */

/* ─── resource_members — generic per-resource membership ──────────
   Bảng tổng quát hoá pattern "user là member của resource X" cho
   mọi loại (agent hiện tại, page/record sau này) qua 1 bảng duy
   nhất. KHÔNG FK resource_id (refer nhiều bảng) — cleanup khi xoá
   resource là trách nhiệm caller. Xem packages/server/src/resource-acl.ts.
   Migration 0044 backfill từ agent_members; 0045 drop bảng cũ. */
export const resourceMembers = pgTable(
  "resource_members",
  {
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    addedBy: uuid("added_by")
      .notNull()
      .references(() => users.id),
    addedAt: timestamp("added_at").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.resourceType, t.resourceId, t.userId] }),
    userIdx: index("resource_members_user_idx").on(t.userId),
    resourceIdx: index("resource_members_resource_idx").on(t.resourceType, t.resourceId),
  }),
);

/* ─── Cấu hình tích hợp ──────────────────────────────────── */
export const mcpConfigs = pgTable(
  "mcp_configs",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    config: jsonb("config").notNull(), // { mode, url, headers }
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    companyNameIdx: uniqueIndex("mcp_configs_company_name_idx").on(t.companyId, t.name),
  }),
);

/** Kết nối MSSQL legacy per-company — dùng cho UI migration.
 *  Password mã hoá qua crypto.ts (AES-256-GCM); chỉ admin xem được
 *  via tRPC (router strip ra trước khi gửi xuống FE). */
export const mssqlConnections = pgTable(
  "mssql_connections",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    host: text("host").notNull(),
    port: integer("port").default(1433).notNull(),
    database: text("database").notNull(),
    username: text("username").notNull(),
    passwordEnc: text("password_enc").default("").notNull(),
    encrypt: boolean("encrypt").default(true).notNull(),
    trustServerCert: boolean("trust_server_cert").default(false).notNull(),
    allowWrite: boolean("allow_write").default(false).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyNameIdx: uniqueIndex("mssql_connections_company_name_idx").on(t.companyId, t.name),
  }),
);

/** Cockpit menu-driven — bản đồ menu app cũ DQHF (bảng SYS_MENU_NEW) import
 *  vào để port dần theo menu. Mỗi row = 1 node menu legacy (mã/tên/cấp/cha/
 *  form/namespace) + portStatus (chua|dang|xong) + pageId (page mới sau khi
 *  port). Re-import chỉ cập nhật metadata, GIỮ portStatus/module/pageId. */
export const legacyMenuMap = pgTable(
  "legacy_menu_map",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    sourceId: integer("source_id").notNull(), // SYS_MENU_NEW.id
    sourceCode: text("source_code").notNull(), // C_MENU
    name: text("name"), // N_MENU
    level: integer("level"), // C_LEVEL (1=cha,2=nhóm,3=mục/form,4=thao tác)
    parentCode: text("parent_code"), // C_MENU_UPPER
    sort: integer("sort").default(0).notNull(), // T_SORT
    winId: text("win_id"), // C_WIN_ID (form class mở bằng reflection)
    namespace: text("namespace"), // NAMESPACE
    system: text("system"), // C_SYSTEM
    isShowDialog: boolean("is_show_dialog").default(false).notNull(),
    active: boolean("active").default(true).notNull(), // F_USE
    portStatus: text("port_status").default("chua").notNull(), // chua|dang|xong
    module: text("module"), // tên migration module sau khi port
    pageId: uuid("page_id").references(() => pages.id, { onDelete: "set null" }),
    // Kết quả resolver: {procs[], controls[], repos[], tables[], filesScanned, note}.
    resolved: jsonb("resolved"),
    resolvedAt: timestamp("resolved_at"),
    importedAt: timestamp("imported_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyCodeIdx: uniqueIndex("legacy_menu_map_company_code_idx").on(t.companyId, t.sourceCode),
  }),
);

/** Cockpit — blueprint báo cáo XtraReports (class rpt_*) trích từ source C#.
 *  Mỗi row = 1 report: tiêu đề + data proc + cột + group + summary. Dùng để
 *  dựng lại report dạng bảng (list page) hoặc làm spec cho template in. */
export const legacyReports = pgTable(
  "legacy_reports",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    reportClass: text("report_class").notNull(), // rpt_bangke_govan
    namespace: text("namespace"),
    title: text("title"),
    kind: text("kind").default("table").notNull(), // table | document
    dataProcs: jsonb("data_procs").default(sql`'[]'::jsonb`).notNull(), // string[]
    columns: jsonb("columns").default(sql`'[]'::jsonb`).notNull(), // string[] header cột
    groups: jsonb("groups").default(sql`'[]'::jsonb`).notNull(), // string[]
    summaries: jsonb("summaries").default(sql`'[]'::jsonb`).notNull(), // string[] (Sum/Count…)
    hasBeforePrint: integer("has_before_print").default(0).notNull(),
    pageId: uuid("page_id").references(() => pages.id, { onDelete: "set null" }),
    parsedAt: timestamp("parsed_at").defaultNow().notNull(),
  },
  (t) => ({
    companyClassIdx: uniqueIndex("legacy_reports_company_class_idx").on(t.companyId, t.reportClass),
  }),
);

/** Engine in PDF — template HTML cho báo cáo/chứng từ in. Render = template +
 *  data (rows từ dataProcedure) → HTML in-ready; xuất PDF qua trình duyệt
 *  (mặc định) hoặc Puppeteer (nếu cài Chromium). */
export const printTemplates = pgTable(
  "print_templates",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // snake_case unique/company
    label: text("label").notNull(),
    reportClass: text("report_class"), // nguồn rpt_* (nếu scaffold từ report)
    dataProcedure: text("data_procedure"), // tên procedure lấy rows
    html: text("html").notNull().default(""), // template (mini-handlebars)
    pageSize: text("page_size").default("A4").notNull(),
    orientation: text("orientation").default("portrait").notNull(), // portrait|landscape
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyNameIdx: uniqueIndex("print_templates_company_name_idx").on(t.companyId, t.name),
  }),
);

/** Phase U — Background full import job từ MSSQL.
 *  1 job = 1 lần user bấm "Full import"; chứa N table riêng.
 *  status: queued | running | paused | completed | failed | canceled
 *  kind:   full (lần đầu) | sync (re-run lấy data mới theo lastPk) */
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

export const runStatus = pgEnum("run_status", ["running", "completed", "paused", "error"]);

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
export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "rejected"]);

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

/* ─── Knowledge Base (RAG) ────────────────────────────────────
   Nguồn tri thức (file tải lên / dữ liệu entity / văn bản dán tay)
   được trích văn bản, cắt đoạn (chunk) rồi sinh embedding. Tra cứu
   bằng ANN cosine trên cột vector — phục vụ ô tìm kiếm UI lẫn tool
   "knowledge_search" của agent. Cần extension pgvector (migration
   0007 bật `CREATE EXTENSION vector`). */
export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // kind: "file" | "entity" | "text"
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    // status: "pending" | "processing" | "ready" | "error"
    status: text("status").notNull().default("pending"),
    // visibility: "company" = mọi user có quyền view:knowledge trong công ty
    //   đều xem (mặc định, tương thích ngược); "restricted" = chỉ admin +
    //   người tạo + user/nhóm được cấp (resource_members resource_type=
    //   'knowledge' + knowledge_source_viewer_groups). Xem knowledge-acl.ts.
    visibility: text("visibility").notNull().default("company"),
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
  },
  (t) => ({
    companyIdIdx: index("knowledge_sources_company_id_idx").on(t.companyId),
  }),
);

/* Đoạn (chunk) có embedding. Cột embedding vector(768) — index HNSW
   cosine tạo trong migration 0007 (drizzle-kit không sinh kiểu index
   này nên viết tay). */
export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    content: text("content").notNull(),
    tokens: integer("tokens").notNull().default(0),
    embedding: vector("embedding", { dimensions: 768 }),
    // search_tsv là GENERATED column (migration 0062) sinh tự động từ
    // content — phục vụ FTS keyword trong hybrid retrieval. Drizzle chỉ
    // khai báo để TS biết; KHÔNG insert/update trực tiếp (generated).
    searchTsv: text("search_tsv"),
  },
  (t) => ({
    companyIdIdx: index("knowledge_chunks_company_id_idx").on(t.companyId),
    sourceIdIdx: index("knowledge_chunks_source_id_idx").on(t.sourceId),
  }),
);

/* Phân quyền nguồn tri thức theo nhóm người xem — mirror page_viewer_groups.
   Nguồn visibility='restricted' gắn ≥1 nhóm → chỉ thành viên nhóm đó (cùng
   admin + người tạo + user được cấp riêng qua resource_members) truy cập. */
export const knowledgeSourceViewerGroups = pgTable(
  "knowledge_source_viewer_groups",
  {
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => viewerGroups.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.sourceId, t.groupId] }) }),
);

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

/* ─── Backup — sao lưu lên Google Drive (UI/cron) ───────── */
/* Mỗi công ty 1 cấu hình. gdriveKeyEnc = JSON service account key đã
   mã hoá AES-256-GCM. scheduleCron NULL = chỉ chạy thủ công. */
export const backupConfig = pgTable(
  "backup_config",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    gdriveKeyEnc: text("gdrive_key_enc").notNull(),
    gdriveFolderId: text("gdrive_folder_id").notNull(),
    scheduleCron: text("schedule_cron"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyUidx: uniqueIndex("backup_config_company_uidx").on(t.companyId),
  }),
);

/* Lịch sử các lần backup. status: running → done | error. */
export const backupRuns = pgTable(
  "backup_runs",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
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
  },
  (t) => ({
    companyStartedIdx: index("backup_runs_company_started_idx").on(t.companyId, t.startedAt),
  }),
);

/* API keys per company — auth cho REST /api/v1/* endpoints. key_hash =
   sha256 của plaintext (sk_...); plaintext chỉ trả 1 lần lúc tạo. scopes
   JSONB array vd ["entity:customer:read"]; empty = full access.
   client_id (v4 OAuth): cho client_credentials flow — POST /oauth/token. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
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
  },
  (t) => ({
    hashIdx: uniqueIndex("api_keys_hash_idx").on(t.keyHash),
    clientIdx: uniqueIndex("api_keys_client_id_idx").on(t.clientId),
    companyIdx: index("api_keys_company_idx").on(t.companyId),
  }),
);

/* Materialized views per company — pre-computed heavy aggregation cho
   dashboard/report. Query SQL custom (admin viết); refresh cron schedule
   ghi data JSONB. Render từ data field — nhanh hơn re-execute query. */

/* Write-once audit log cho compliance — trigger BEFORE UPDATE OR DELETE
   ném exception. Mirror activity_log nhưng cho event critical (auth,
   record write, RBAC change). Ai cũng không sửa/xoá được sau INSERT. */
export const auditLogImmutable = pgTable(
  "audit_log_immutable",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id"),
    kind: text("kind").notNull(),
    objectType: text("object_type"),
    target: text("target"),
    targetId: uuid("target_id"),
    actorUserId: uuid("actor_user_id"),
    detail: text("detail").notNull(),
    diff: jsonb("diff"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    companyKindIdx: index("ali_company_kind_idx").on(t.companyId, t.kind, t.createdAt),
    targetIdx: index("ali_target_idx").on(t.targetId),
  }),
);

/* OAuth refresh tokens — long-lived; rotate khi dùng (issue new + revoke cũ).
   Token plaintext "rt_<hex>" → sha256 → token_hash. */
export const oauthRefreshTokens = pgTable(
  "oauth_refresh_tokens",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    apiKeyId: uuid("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    tokenHashIdx: uniqueIndex("ort_token_hash_idx").on(t.tokenHash),
  }),
);

/* OAuth authorization codes — short-lived (10 phút), PKCE bắt buộc.
   code_challenge = sha256(verifier) base64url. Method "S256" only. */
export const oauthAuthCodes = pgTable(
  "oauth_auth_codes",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    codeHash: text("code_hash").notNull(),
    clientId: text("client_id").notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    apiKeyId: uuid("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    codeChallengeMethod: text("code_challenge_method").notNull().default("S256"),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    codeHashIdx: uniqueIndex("oac_code_hash_idx").on(t.codeHash),
  }),
);

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

/* ─── Feedback — user báo bất cập + đề xuất cải thiện ───────────
   Pipeline 3 bước (new → in_progress → done) + nhánh wontfix.
   Anchor: area (taxonomy text) + url hiện tại + optional entityRef.
   AI enrichment async qua pg-boss: aiSummary + aiTags + embedding.
   Tương tác: upvote (bảng riêng) + comments thread (bảng riêng). */
export const feedbackStatus = pgEnum("feedback_status", ["new", "in_progress", "done", "wontfix"]);
export const feedbackSeverity = pgEnum("feedback_severity", ["nice_to_have", "normal", "blocker"]);

export const feedbacks = pgTable(
  "feedbacks",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    body: text("body").notNull(), // mô tả bất cập
    suggestion: text("suggestion"), // đề xuất cải thiện
    area: text("area").notNull(), // entity|workflow|agent|settings|ui|performance|other
    url: text("url"), // URL trang khi submit (auto-capture)
    entityRef: jsonb("entity_ref"), // {entityId?, recordId?}
    severity: feedbackSeverity("severity").notNull().default("normal"),
    status: feedbackStatus("status").notNull().default("new"),
    resolutionNote: text("resolution_note"), // admin điền khi đóng
    /* AI-generated, lazy fill qua queue feedback-ai. NULL khi worker chưa chạy. */
    aiSummary: text("ai_summary"),
    aiTags: jsonb("ai_tags"), // string[]
    embedding: vector("embedding", { dimensions: 768 }), // cùng model với knowledge
    voteCount: integer("vote_count").notNull().default(0), // denormalize cho list sort
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => ({
    companyStatusIdx: index("feedbacks_company_status_idx").on(t.companyId, t.status),
    companyAreaIdx: index("feedbacks_company_area_idx").on(t.companyId, t.area),
    authorIdx: index("feedbacks_author_idx").on(t.authorUserId),
  }),
);

/* Upvote idempotent qua PK composite — bấm 2 lần không nhân đôi. */
export const feedbackVotes = pgTable(
  "feedback_votes",
  {
    feedbackId: uuid("feedback_id")
      .notNull()
      .references(() => feedbacks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.feedbackId, t.userId] }),
  }),
);

/* Bảng riêng — record_comments FK cứng vào entity_records nên không trỏ
   feedback được. Clone cấu trúc, hỗ trợ nested reply qua parentId. */
export const feedbackComments = pgTable(
  "feedback_comments",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    feedbackId: uuid("feedback_id")
      .notNull()
      .references(() => feedbacks.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => ({
    feedbackIdx: index("feedback_comments_feedback_idx").on(t.feedbackId),
  }),
);

/* ─── Đợt gộp feedback (admin "đánh dấu" 1 lần gộp để đổi trạng thái
   hàng loạt sau này). feedbackIds là snapshot id tại thời điểm lưu —
   mục bị xoá sẽ bỏ qua khi áp dụng. ─────────────────────────────── */
export const feedbackMergeBatches = pgTable(
  "feedback_merge_batches",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    note: text("note"),
    // Snapshot filter lúc gộp: { status?, area?, mine? }.
    filterSnapshot: jsonb("filter_snapshot"),
    // Snapshot danh sách feedback id (string[]).
    feedbackIds: jsonb("feedback_ids").notNull(),
    itemCount: integer("item_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyCreatedIdx: index("feedback_merge_batches_company_created_idx").on(
      t.companyId,
      t.createdAt,
    ),
  }),
);

/* ─── Lộ trình nâng cấp / task-fix (roadmap_items) ─────────────────
   Đích đến của đề xuất AI khi "thêm vào lộ trình". 1 mục có thể gom
   nhiều feedback (feedback_ids). source=manual (admin tạo) | ai_proposal
   (sinh khi duyệt 1 ai_proposals). created_by null = AI/hệ thống. */
export const roadmapItems = pgTable(
  "roadmap_items",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    area: text("area"), // entity|workflow|agent|settings|ui|performance|other
    status: text("status").notNull().default("planned"), // planned|in_progress|done|dropped
    priority: text("priority").notNull().default("normal"), // low|normal|high
    targetQuarter: text("target_quarter"), // vd 2026-Q3
    feedbackIds: jsonb("feedback_ids").notNull().default(sql`'[]'::jsonb`), // string[]
    source: text("source").notNull().default("manual"), // manual|ai_proposal
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyStatusIdx: index("roadmap_items_company_status_idx").on(t.companyId, t.status),
  }),
);

/* ─── Đề xuất AI chờ preview/duyệt (ai_proposals) ──────────────────
   MCP server cho AI ĐỌC feedback + GHI đề xuất ở trạng thái pending.
   AI KHÔNG mutate trực tiếp — admin duyệt trong UI rồi mới
   applyProposalActions (đổi status / đánh dấu trùng / thêm lộ trình).
   actions: ProposalAction[] (xem feedback-proposals.ts). */
export const aiProposals = pgTable(
  "ai_proposals",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    summary: text("summary"), // markdown AI viết — nội dung preview
    actions: jsonb("actions").notNull().default(sql`'[]'::jsonb`), // ProposalAction[]
    feedbackIds: jsonb("feedback_ids").notNull().default(sql`'[]'::jsonb`), // string[]
    status: text("status").notNull().default("pending"), // pending|approved|rejected|applied|superseded
    createdByKind: text("created_by_kind").notNull().default("ai"), // ai|user
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    reviewNote: text("review_note"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at"),
    appliedAt: timestamp("applied_at"),
    applyResult: jsonb("apply_result"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyStatusIdx: index("ai_proposals_company_status_idx").on(t.companyId, t.status),
  }),
);

/* ─── Lịch sử trò chuyện với Agent (per-user, có thể xoá) ─────────── */
export const agentConversations = pgTable(
  "agent_conversations",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // userId: chủ cuộc trò chuyện — riêng tư từng tài khoản.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // agentId: agent đang gắn (null nếu chat tự do). Agent bị xoá → giữ lịch sử.
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    title: text("title").notNull().default("Cuộc trò chuyện"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("agent_conversations_user_idx").on(t.companyId, t.userId, t.updatedAt),
  }),
);

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => agentConversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // "user" | "assistant"
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    convIdx: index("agent_messages_conv_idx").on(t.conversationId, t.createdAt),
  }),
);

/* ─── MES: Mục tiêu sản xuất (port DQHF) ──────────────────── */

/** v1 — mục tiêu đơn giản theo ngày / đơn hàng / công đoạn. */
export const mesMucTieuSanXuat = pgTable(
  "mes_muctieu_sanxuat",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    ngaythang: date("ngaythang", { mode: "date" }).notNull(),
    maCongDoan: text("ma_cong_doan").notNull(),
    donHang: text("don_hang").notNull().default(""),
    heHang: text("he_hang").notNull().default(""),
    mucTieu: doublePrecision("muc_tieu").notNull().default(0),
    soNguoi: integer("so_nguoi").notNull().default(0),
    soGio: doublePrecision("so_gio").notNull().default(8),
    nguoiTao: text("nguoi_tao").notNull().default(""),
    ngayTao: timestamp("ngay_tao").defaultNow().notNull(),
    nguoiSua: text("nguoi_sua").notNull().default(""),
    ngaySua: timestamp("ngay_sua").defaultNow().notNull(),
  },
  (t) => ({
    ngayIdx: index("mes_muctieu_sanxuat_company_ngay_idx").on(
      t.companyId,
      t.maCongDoan,
      t.ngaythang,
    ),
  }),
);

/** v2 header — tổng hợp tháng theo mức thưởng (1–4). 25 cột tính toán bởi tinhtoan(). */
export const mesMucTieuSanXuatThang = pgTable(
  "mes_muctieu_sanxuat_thang",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    nam: integer("nam").notNull(),
    thang: integer("thang").notNull(),
    maBoPhan: text("ma_bo_phan").notNull(),
    mucThuong: integer("muc_thuong").notNull().default(1),
    soNguoi: integer("so_nguoi").notNull().default(0),
    soNgay: doublePrecision("so_ngay").notNull().default(0),
    phantramTang: doublePrecision("phantram_tang"),
    col1: doublePrecision("col1"),
    col2: doublePrecision("col2"),
    col3: doublePrecision("col3"),
    col4: doublePrecision("col4"),
    col5: doublePrecision("col5"),
    col6: doublePrecision("col6"),
    col7: doublePrecision("col7"),
    col8: doublePrecision("col8"),
    col9: doublePrecision("col9"),
    col10: doublePrecision("col10"),
    col11: doublePrecision("col11"),
    col12: doublePrecision("col12"),
    col13: doublePrecision("col13"),
    col14: doublePrecision("col14"),
    col15: doublePrecision("col15"),
    col16: doublePrecision("col16"),
    col17: doublePrecision("col17"),
    col18: text("col18"),
    col19: doublePrecision("col19"),
    col20: doublePrecision("col20"),
    col21: doublePrecision("col21"),
    col22: doublePrecision("col22"),
    col23: doublePrecision("col23"),
    col24: doublePrecision("col24"),
    col25: doublePrecision("col25"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    uk: uniqueIndex("mes_muctieu_sanxuat_thang_uk").on(
      t.companyId,
      t.nam,
      t.thang,
      t.maBoPhan,
      t.mucThuong,
    ),
  }),
);

/** v2 chi tiết — từng ngày trong tháng cho 1 bộ phận. */
export const mesMucTieuSanXuatChitiet = pgTable(
  "mes_muctieu_sanxuat_chitiet",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    maCongDoan: text("ma_cong_doan").notNull(),
    ngaythang: date("ngaythang", { mode: "date" }).notNull(),
    // day_name: GENERATED ALWAYS AS — luôn đúng, không cần set trong code
    dayName: text("day_name").generatedAlwaysAs(
      sql`CASE EXTRACT(DOW FROM ngaythang)::int WHEN 0 THEN 'Sun' WHEN 1 THEN 'Mon' WHEN 2 THEN 'Tue' WHEN 3 THEN 'Wed' WHEN 4 THEN 'Thu' WHEN 5 THEN 'Fri' ELSE 'Sat' END`,
    ),
    mucTieuSoGio: doublePrecision("muc_tieu_so_gio").notNull().default(0),
    mucTieuSoNguoi: integer("muc_tieu_so_nguoi").notNull().default(0),
    mucTieuTongGioHc: doublePrecision("muc_tieu_tonggio_hc").notNull().default(0),
    mucTieuTongGioTc: doublePrecision("muc_tieu_tonggio_tc").notNull().default(0),
    mucTieuTongGio: doublePrecision("muc_tieu_tonggio").notNull().default(0),
    mucTieuSoKhoiTheoHc: doublePrecision("muc_tieu_sokhoi_theo_hc").notNull().default(0),
    mucTieuSoKhoiTheoTangCa: doublePrecision("muc_tieu_sokhoi_theo_tangca").notNull().default(0),
    mucTieuSoKhoiTrungBinh: doublePrecision("muc_tieu_sokhoi_trungbinh").notNull().default(0),
    soNguoiHienDienHc: integer("so_nguoi_hiendien_hc").notNull().default(0),
    soNguoiHienDienTc: integer("so_nguoi_hiendien_tc").notNull().default(0),
    veGiuaGio: doublePrecision("ve_giua_gio").notNull().default(0),
    contRoi: doublePrecision("cont_roi").notNull().default(0),
    contRap: doublePrecision("cont_rap").notNull().default(0),
    soKhoiHoanThanh: doublePrecision("sokhoi_hoanthanh").notNull().default(0),
    tongGio: doublePrecision("tonggio").notNull().default(0),
    soKhoi: doublePrecision("sokhoi").notNull().default(0),
    tile: doublePrecision("tile").notNull().default(0),
    tileHoanThanh: doublePrecision("tile_hoanthanh").notNull().default(0),
    gioChenhlech: doublePrecision("gio_chenhlech").notNull().default(0),
    gioCanBu: doublePrecision("gio_canbu").notNull().default(0),
  },
  (t) => ({
    uk: uniqueIndex("mes_muctieu_sanxuat_chitiet_uk").on(t.companyId, t.maCongDoan, t.ngaythang),
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
