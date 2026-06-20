import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
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
import { userRole } from "./enums";

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
