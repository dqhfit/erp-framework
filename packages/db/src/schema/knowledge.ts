import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { viewerGroups } from "./pages";
import { companies } from "./tenant";

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
    // visibility: "private" = chỉ người tạo; "restricted" = chỉ admin +
    //   người tạo + user/nhóm được cấp; "company" = mọi user trong công ty
    //   (mặc định, tương thích ngược); "public" = ai có share_token đều xem.
    //   Xem knowledge-acl.ts.
    visibility: text("visibility").notNull().default("company"),
    // share_token: UUID cho link chia sẻ công khai (không cần login).
    // Chỉ set khi visibility='public'. Unique index đảm bảo không trùng.
    shareToken: uuid("share_token"),
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
