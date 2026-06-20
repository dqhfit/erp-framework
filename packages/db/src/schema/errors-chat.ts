import { sql } from "drizzle-orm";
import {
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
import { companies } from "./tenant";
import { agents } from "./workflows";

/* ─── Lỗi phía client (client_errors) ─────────────────────────────
   App tự gửi lỗi runtime (window.onerror / unhandledrejection / React
   ErrorBoundary) về server qua tRPC errors.report. Gom trùng theo
   fingerprint (server tính từ message + frame stack đầu) — cùng 1 lỗi
   lặp lại chỉ tăng count + last_seen, KHÔNG đẻ dòng mới (chống ngập DB).
   Admin theo dõi/triage ở /settings/errors. MCP server (mcp-errors.ts)
   cho AI ĐỌC + ĐỔI TRẠNG THÁI/XOÁ lỗi (scope errors:read|write). */
export const clientErrors = pgTable(
  "client_errors",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // user gặp lỗi — giữ lỗi khi user bị xoá (set null).
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    fingerprint: text("fingerprint").notNull(), // khoá gom trùng (server tính)
    level: text("level").notNull().default("error"), // error|warn
    source: text("source").notNull().default("unknown"), // window.onerror|unhandledrejection|react|manual
    message: text("message").notNull(),
    stack: text("stack"),
    componentStack: text("component_stack"), // React error boundary
    url: text("url"), // URL trang lúc lỗi
    userAgent: text("user_agent"),
    meta: jsonb("meta"), // ngữ cảnh thêm (release, props…)
    status: text("status").notNull().default("open"), // open|resolved|ignored
    count: integer("count").notNull().default(1), // số lần lặp (gom trùng)
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // Gom trùng: 1 fingerprint / công ty → onConflictDoUpdate tăng count.
    companyFingerprintUniq: uniqueIndex("client_errors_company_fingerprint_uniq").on(
      t.companyId,
      t.fingerprint,
    ),
    companyStatusSeenIdx: index("client_errors_company_status_seen_idx").on(
      t.companyId,
      t.status,
      t.lastSeenAt,
    ),
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
