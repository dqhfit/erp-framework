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
import { feedbackSeverity, feedbackStatus } from "./enums";
import { apiKeys } from "./security";
import { companies } from "./tenant";

/* ─── Feedback — user báo bất cập + đề xuất cải thiện ───────────
   Pipeline 3 bước (new → in_progress → done) + nhánh wontfix.
   Anchor: area (taxonomy text) + url hiện tại + optional entityRef.
   AI enrichment async qua pg-boss: aiSummary + aiTags + embedding.
   Tương tác: upvote (bảng riêng) + comments thread (bảng riêng). */

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
