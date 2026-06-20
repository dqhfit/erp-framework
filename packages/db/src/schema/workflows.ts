import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
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
import { workflowTrigger } from "./enums";
import { companies } from "./tenant";

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
    // sourceTemplateId: id template (workflow-templates.ts) nếu workflow clone từ
    // thư viện mẫu — null = tạo tay. Dùng để biết nguồn gốc / cập nhật về sau.
    sourceTemplateId: text("source_template_id"),
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
