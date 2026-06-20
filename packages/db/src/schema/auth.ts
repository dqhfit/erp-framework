import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { userRole } from "./enums";
import { companies } from "./tenant";
import { agents } from "./workflows";

/* ─── Người dùng & phiên ────────────────────────────────── */

export const users = pgTable("users", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  // role: vai trò mặc định khi tạo công ty mới — vai trò HIỆU LỰC theo
  // từng công ty nằm ở company_members.role.
  role: userRole("role").notNull().default("viewer"),
  // Định danh LEGACY DQHF (bridge login MD5): chỉ set cho user được lazy-tạo
  // từ sys_user. Bridge khớp/ghi-đè CHỈ user có cùng (legacy_company_id,
  // legacy_username) — KHÔNG bao giờ đụng user framework thường (chống account
  // takeover qua va chạm email tổng hợp). Unique partial index ở migration 0077.
  legacyUsername: text("legacy_username"),
  legacyCompanyId: uuid("legacy_company_id"),
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
