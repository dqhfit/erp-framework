import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { pages } from "./pages";
import { companies } from "./tenant";

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
    // Override cấu trúc do người dùng sửa tay (name/parentCode/sort/active) — giữ
    // qua re-import: import ghi đè cột raw, rồi reapplyMenuOverrides() áp lại.
    overrides: jsonb("overrides"),
    // Node người dùng tự thêm trong app (không có trong SYS_MENU_NEW) → import bỏ qua.
    custom: boolean("custom").default(false).notNull(),
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
