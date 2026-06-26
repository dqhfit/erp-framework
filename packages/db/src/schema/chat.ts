/* ==========================================================
   chat.ts — Chat noi bo nhan vien (DM 1-1 + nhom).
   Nhan vien cung 1 cong ty nhan tin voi nhau; KHAC agent_conversations
   (chat voi AI) va record_comments (binh luan tren ban ghi).
   Da tenant: moi bang mang company_id, cascade theo companies.
   Real-time qua ws-hub (kenh "chat:<conversationId>" + "chat-inbox:<userId>").
   ========================================================== */
import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { companies } from "./tenant";

/* ─── Cuoc tro chuyen (DM hoac nhom) ─────────────────────── */
export const chatConversations = pgTable(
  "chat_conversations",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // "dm" | "group"
    // null cho DM (suy ra ten tu doi phuong); bat buoc cho nhom.
    title: text("title"),
    // Khoa chuan-hoa cap DM: sort 2 userId roi noi "<a>:<b>" — chong tao
    // trung DM. null cho nhom (cho phep nhieu nhom cung thanh vien).
    dmKey: text("dm_key"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyIdx: index("chat_conversations_company_idx").on(t.companyId, t.updatedAt),
    // 1 DM duy nhat / cap / cong ty. dm_key null (nhom) khong bi rang buoc
    // (Postgres coi NULL la phan biet trong unique index).
    dmUniq: uniqueIndex("chat_conversations_dm_uniq").on(t.companyId, t.dmKey),
  }),
);

/* ─── Thanh vien cuoc tro chuyen ─────────────────────────── */
export const chatMembers = pgTable(
  "chat_members",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // "owner" | "member"
    // Moc da doc cuoi cung — dem chua doc = so tin moi hon moc nay.
    lastReadAt: timestamp("last_read_at"),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.conversationId, t.userId] }),
    userIdx: index("chat_members_user_idx").on(t.userId),
  }),
);

/* ─── Tin nhan ───────────────────────────────────────────── */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    // company_id lap lai (de scope/loc nhanh khong phai join conversations).
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    senderUserId: uuid("sender_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    // Dinh kem: mang [{url, name, mime, size}] (URL ky HMAC /f/<token>).
    attachments:
      jsonb("attachments").$type<{ url: string; name: string; mime?: string; size?: number }[]>(),
    editedAt: timestamp("edited_at"), // moc sua tin (null = chua sua)
    deletedAt: timestamp("deleted_at"), // xoa mem (chi chu tin)
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    convIdx: index("chat_messages_conv_idx").on(t.conversationId, t.createdAt),
  }),
);

/* ─── Reaction (tha cam xuc emoji len tin nhan) ──────────── */
export const chatMessageReactions = pgTable(
  "chat_message_reactions",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.messageId, t.userId, t.emoji] }),
    msgIdx: index("chat_message_reactions_msg_idx").on(t.messageId),
  }),
);
