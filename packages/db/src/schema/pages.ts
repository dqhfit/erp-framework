import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
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
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { companies } from "./tenant";

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
    // Cờ trạng thái (lifecycle) gắn cho trang — độc lập với published.
    // Giá trị = key built-in (new/in_progress/review/done/published/archived)
    // hoặc id (uuid) của cờ tùy chỉnh trong page_flags. null = chưa gắn cờ.
    status: text("status"),
    // Xoá mềm: null = active, ts = đã xoá (còn khôi phục từ thùng rác).
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // Unique tên CHỈ ràng buộc trang active → trang đã xoá mềm không chiếm tên.
    companyNameIdx: uniqueIndex("pages_company_name_idx")
      .on(t.companyId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    deletedAtIdx: index("pages_deleted_at_idx").on(t.deletedAt),
  }),
);

/* page_flags — co (flag) trang thai TUY CHINH per-company ("co cua toi").
   Nguoi dung tu them ngoai bo co built-in (new/in_progress/.../archived).
   pages.status luu key built-in HOAC id (uuid) cua 1 dong o day.
   color = ten token semantic (accent/accent-2/success/warning/danger/neutral)
   de doi theo theme sang/toi, KHONG hardcode hex. */
export const pageFlags = pgTable(
  "page_flags",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    color: text("color").notNull().default("accent"),
    icon: text("icon"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyIdx: index("page_flags_company_idx").on(t.companyId),
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

/** Quyền truy cập trang per-user — ưu tiên hơn nhóm (user thấy trang dù không trong nhóm). */
export const userPageAccess = pgTable(
  "user_page_access",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.pageId] }) }),
);
