/* ==========================================================
   router.ts — tRPC AppRouter.
   - auth.*       : đăng ký / đăng nhập / đăng xuất / thông tin
   - entities.*   : CRUD metadata entity         (RBAC)
   - records.*    : CRUD dữ liệu động            (RBAC + validate-on-write)
   - workflows.*  : trigger workflow             (RBAC)
   ========================================================== */
import { z } from "zod";
import { and, eq, sql, desc, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  entities, entityRecords, entityRecordVersions,
  users, sessions, mcpConfigs, llmProfiles,
  pages, agents, agentMembers, workflows, schedules, activityLog,
  companies, companyMembers, userInvites,
} from "@erp-framework/db";
import { validateRecord, pluginRegistry, fieldCan, type EntityFieldDef, type OnDeleteBehavior, type Role } from "@erp-framework/core";
import { router, publicProcedure, protectedProcedure, rbacProcedure, rateLimit } from "./trpc";
import { assertCanActOnAgent } from "./agent-acl";
import { logActivity } from "./activity";
import { companiesRouter } from "./companies-router";
import { heartbeatsRouter } from "./heartbeats-router";
import { entitySyncRouter } from "./entity-sync-router";
import { governanceRouter } from "./governance-router";
import { pluginsRouter } from "./plugins-router";
import { proceduresRouter } from "./procedures-router";
import { enumsRouter } from "./enums-router";
import { makeInvokeProcedure } from "./procedure-runner";
import { makeCallTool } from "./mcp-client";
import { embedRouter } from "./embed-router";
import { knowledgeRouter } from "./knowledge-router";
import { iotRouter } from "./iot-router";
import { backupRouter } from "./backup-router";
import { encryptSecret, decryptSecret } from "./crypto";
import { getBudget, setBudget, monthUsageUsd } from "./budget";
import { exportBundle, importBundle } from "./transfer";
import {
  hashPassword, verifyPassword, newSessionToken,
  SESSION_TTL_MS, SESSION_COOKIE,
} from "./auth";
import type { DB } from "./db";
import { executeWorkflow, recentRuns } from "./run-workflow";
import { allDefaultTemplates } from "./agent-memory";

/* ─── Schema input ───────────────────────────────────────── */
/* Khoá phụ tầng app (id field, ref lookup) khai báo TƯỜNG MINH để
   field round-trip nguyên vẹn — KHÔNG dùng .passthrough() vì nó
   thêm index-signature vào kiểu suy luận, làm vỡ ApiDataSource
   (EntityFieldDef không có index-signature). */
const fieldDef = z.object({
  name: z.string(),
  label: z.string(),
  type: z.string(),  // chuỗi tuỳ ý — cho phép cả kiểu do plugin thêm
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  relationEntityId: z.string().optional(),
  formula: z.string().optional(),
  filterable: z.boolean().optional(),
  sortable: z.boolean().optional(),
  id: z.string().optional(),
  ref: z.string().optional(),
});

const entityInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  fields: z.array(fieldDef),
  // meta: dữ liệu phụ tầng app (mcp, mcpBindings…) — không ràng buộc schema.
  meta: z.record(z.unknown()).optional(),
});

/* Trang / workflow / agent — metadata low-code do designer tạo.
   Nội dung designer nằm trong cột JSONB (content / graph / config). */
const pageInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  content: z.record(z.unknown()).optional(),
});

const agentInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  model: z.string().min(1),
  config: z.record(z.unknown()).optional(),
  // managerId: agent cấp trên (org chart). null = gỡ cấp trên.
  managerId: z.string().uuid().nullable().optional(),
});

const workflowInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  triggerType: z.enum(["manual", "webhook", "cron", "entity_changed"]).optional(),
  graph: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

/* Lịch chạy workflow (cron). pg-boss quét bảng schedules mỗi phút. */
const scheduleInput = z.object({
  id: z.string().uuid().optional(),
  workflowId: z.string().uuid(),
  cronExpr: z.string().min(1),
  enabled: z.boolean().optional(),
});

const filterOp = z.enum(["=", "!=", ">", ">=", "<", "<=", "contains", "in"]);
const queryParams = z.object({
  filters: z.record(z.object({ op: filterOp, value: z.unknown() })).optional(),
  sort: z.object({ field: z.string(), dir: z.enum(["asc", "desc"]) }).optional(),
  limit: z.number().int().positive().max(500).optional(),
  offset: z.number().int().nonnegative().optional(),
  /** Full-text search — match @@ trên search_tsv (Postgres). */
  q: z.string().optional(),
}).optional();
type QueryParamsInput = z.infer<typeof queryParams>;

/* Dựng WHERE cho record động. Toán tử khoảng cần expression
   index mới nhanh — xem UPGRADE-PLAN 3.5.
   - includeDeleted=false (mặc định): chỉ lấy record active (deleted_at IS NULL).
   - includeDeleted=true: lấy hết để UI hiện tab "Đã xoá". */
function buildRecordWhere(
  companyId: string,
  entityId: string,
  query: QueryParamsInput,
  includeDeleted: boolean = false,
): SQL | undefined {
  const conds: SQL[] = [
    eq(entityRecords.companyId, companyId),
    eq(entityRecords.entityId, entityId),
  ];
  if (!includeDeleted) {
    conds.push(sql`${entityRecords.deletedAt} IS NULL`);
  }
  // Full-text search: dùng search_tsv column được trigger Postgres update từ
  // field được mark searchable. websearch_to_tsquery tha thứ syntax (quote,
  // OR, dấu trừ) — phù hợp input UI search bar.
  if (query?.q && query.q.trim()) {
    conds.push(sql`${entityRecords.searchTsv}::tsvector @@ websearch_to_tsquery('simple', ${query.q.trim()})`);
  }
  for (const [field, cond] of Object.entries(query?.filters ?? {})) {
    const txt = sql`(${entityRecords.data}->>${field})`;
    switch (cond.op) {
      case "=":  conds.push(sql`${txt} = ${String(cond.value)}`); break;
      case "!=": conds.push(sql`${txt} <> ${String(cond.value)}`); break;
      case "contains":
        conds.push(sql`${txt} ILIKE ${"%" + String(cond.value) + "%"}`); break;
      case ">":  conds.push(sql`${txt}::numeric >  ${Number(cond.value)}`); break;
      case ">=": conds.push(sql`${txt}::numeric >= ${Number(cond.value)}`); break;
      case "<":  conds.push(sql`${txt}::numeric <  ${Number(cond.value)}`); break;
      case "<=": conds.push(sql`${txt}::numeric <= ${Number(cond.value)}`); break;
      case "in": {
        const arr = Array.isArray(cond.value) ? cond.value.map(String) : [];
        conds.push(sql`${txt} = ANY(${arr})`);
        break;
      }
    }
  }
  return and(...conds);
}

/** Nạp định nghĩa field của một entity (trong phạm vi công ty).
   Ném NOT_FOUND nếu entity vắng hoặc thuộc công ty khác. */
async function loadEntityFields(
  db: DB,
  companyId: string,
  entityId: string,
): Promise<EntityFieldDef[]> {
  const [row] = await db.select({ fields: entities.fields })
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.companyId, companyId)));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Entity không tồn tại" });
  return (row.fields ?? []) as EntityFieldDef[];
}

/** Ném BAD_REQUEST nếu validate-on-write thất bại.
   Truyền pluginRegistry để coerce được cả kiểu field do plugin thêm. */
function assertValid(fields: EntityFieldDef[], data: Record<string, unknown>, partial: boolean) {
  const v = validateRecord(fields, data, { partial, registry: pluginRegistry });
  if (!v.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Dữ liệu không hợp lệ — "
        + v.errors.map((e) => `${e.field}: ${e.message}`).join("; "),
    });
  }
  return v.data;
}

/** Quét tất cả entity trong công ty có field lookup/multi-lookup, tìm các
 *  record active đang trỏ tới targetRecordId. Trả group theo entity:
 *  [{ entityId, entityName, entityLabel, fieldKey, count, sampleIds[] }].
 *  Dùng cho records.backRefs (UI hiển thị "5 đơn hàng trỏ tới khách") và
 *  applyCascadeOnDelete (xử lý onDelete behavior). */
async function scanBackRefs(
  db: DB, companyId: string, targetRecordId: string,
): Promise<Array<{
  entityId: string; entityName: string; entityLabel: string;
  fieldKey: string; fieldType: string; count: number; sampleIds: string[];
}>> {
  const ents = await db.select({
    id: entities.id, name: entities.name, label: entities.label,
    fields: entities.fields,
  }).from(entities).where(eq(entities.companyId, companyId));

  const out: Array<{
    entityId: string; entityName: string; entityLabel: string;
    fieldKey: string; fieldType: string; count: number; sampleIds: string[];
  }> = [];

  for (const ent of ents) {
    const fields = (ent.fields ?? []) as Array<{
      name: string; type: string; relationEntityId?: string;
    }>;
    for (const f of fields) {
      if (f.type !== "lookup" && f.type !== "multilookup"
          && f.type !== "multi-lookup" && f.type !== "relation") continue;
      // Tìm record active của entity này có data->fieldKey trỏ tới target.
      // Lookup: equality. Multi-lookup: containment trong JSONB array.
      const isMulti = f.type === "multilookup" || f.type === "multi-lookup";
      const filter = isMulti
        ? sql`${entityRecords.data}->${f.name} @> ${JSON.stringify(targetRecordId)}::jsonb`
        : sql`${entityRecords.data}->>${f.name} = ${targetRecordId}`;
      const rows = await db.select({ id: entityRecords.id }).from(entityRecords)
        .where(and(
          eq(entityRecords.companyId, companyId),
          eq(entityRecords.entityId, ent.id),
          sql`${entityRecords.deletedAt} IS NULL`,
          filter,
        ))
        .limit(50);
      if (rows.length > 0) {
        out.push({
          entityId: ent.id, entityName: ent.name, entityLabel: ent.label,
          fieldKey: f.name, fieldType: f.type,
          count: rows.length, sampleIds: rows.slice(0, 5).map((r) => r.id),
        });
      }
    }
  }
  return out;
}

/** Áp dụng hành vi onDelete (restrict/setnull/cascade) cho mọi back-ref.
 *  Default = restrict (an toàn nhất — fail-fast nếu còn ref). */
async function applyCascadeOnDelete(
  db: DB, companyId: string, targetRecordId: string, actorUserId: string,
): Promise<void> {
  const backRefs = await scanBackRefs(db, companyId, targetRecordId);
  if (backRefs.length === 0) return;

  // Lấy onDelete behavior từ field def cho mỗi back-ref.
  const ents = await db.select({
    id: entities.id, fields: entities.fields,
  }).from(entities).where(eq(entities.companyId, companyId));
  const entFields = new Map(ents.map((e) => [e.id, (e.fields ?? []) as Array<{
    name: string; type: string; onDelete?: OnDeleteBehavior;
  }>]));

  for (const ref of backRefs) {
    const f = entFields.get(ref.entityId)?.find((ff) => ff.name === ref.fieldKey);
    const behavior: OnDeleteBehavior = f?.onDelete ?? "restrict";

    if (behavior === "restrict") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Không xoá được — còn ${ref.count} record ở "${ref.entityLabel}" trỏ tới (field "${ref.fieldKey}"). Đổi onDelete hoặc xoá các record nguồn trước.`,
      });
    }

    // Lấy danh sách record nguồn cần xử lý (giới hạn ở sampleIds đã lấy + extend).
    const allRefs = await db.select({
      id: entityRecords.id, data: entityRecords.data, version: entityRecords.version,
    }).from(entityRecords).where(and(
      eq(entityRecords.companyId, companyId),
      eq(entityRecords.entityId, ref.entityId),
      sql`${entityRecords.deletedAt} IS NULL`,
      ref.fieldType === "multilookup" || ref.fieldType === "multi-lookup"
        ? sql`${entityRecords.data}->${ref.fieldKey} @> ${JSON.stringify(targetRecordId)}::jsonb`
        : sql`${entityRecords.data}->>${ref.fieldKey} = ${targetRecordId}`,
    ));

    if (behavior === "setnull") {
      for (const r of allRefs) {
        const data = { ...(r.data as Record<string, unknown>) };
        if (ref.fieldType === "multilookup" || ref.fieldType === "multi-lookup") {
          const arr = (data[ref.fieldKey] as string[] | undefined) ?? [];
          data[ref.fieldKey] = arr.filter((id) => id !== targetRecordId);
        } else {
          data[ref.fieldKey] = null;
        }
        await db.update(entityRecords).set({
          data, version: r.version + 1, updatedAt: new Date(),
        }).where(eq(entityRecords.id, r.id));
      }
    } else if (behavior === "cascade") {
      // Soft-delete chuỗi — đệ quy để cascade tiếp các back-ref của nó.
      // Giới hạn depth không có (back-refs không tạo cycle nếu DAG); với
      // cycle, các record đã soft-delete ở vòng trước sẽ bị scanBackRefs
      // bỏ qua (deleted_at IS NULL filter), không loop vô tận.
      for (const r of allRefs) {
        await applyCascadeOnDelete(db, companyId, r.id, actorUserId);
        await db.update(entityRecords).set({
          deletedAt: new Date(), updatedAt: new Date(),
        }).where(eq(entityRecords.id, r.id));
      }
    }
  }
}

/** Sinh giá trị sequence atomic per (company, entity, field) — SELECT FOR
 *  UPDATE + INCREMENT. Lần đầu tạo row entity_sequences (next_value=2 sau khi
 *  dùng 1). Định dạng: prefix + str(value).padStart(padding, '0'). */
async function nextSequence(
  db: DB, companyId: string, entityName: string,
  field: { name: string; sequencePrefix?: string; sequencePadding?: number },
): Promise<string> {
  // Postgres-side atomic: INSERT ... ON CONFLICT DO UPDATE returning.
  const [row] = await db.execute(sql`
    INSERT INTO entity_sequences (company_id, entity_name, field_key, next_value)
    VALUES (${companyId}::uuid, ${entityName}, ${field.name}, 2)
    ON CONFLICT (company_id, entity_name, field_key)
    DO UPDATE SET next_value = entity_sequences.next_value + 1, updated_at = now()
    RETURNING next_value - 1 AS used
  `) as unknown as Array<{ used: number }>;
  const used = row?.used ?? 1;
  const pad = field.sequencePadding ?? 0;
  const num = pad > 0 ? String(used).padStart(pad, "0") : String(used);
  return (field.sequencePrefix ?? "") + num;
}

/** Loại bỏ key user không có quyền GHI (writableBy) trước khi validate.
 *  Bảo vệ field như "salary" không bị user viewer override. */
function stripUnwritableFields(
  fields: EntityFieldDef[], data: Record<string, unknown>, role: Role,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    const f = fields.find((ff) => ff.name === k);
    if (!f) { out[k] = v; continue; }
    if (fieldCan(role, "write", f)) out[k] = v;
  }
  return out;
}

/** Loại bỏ key user không có quyền ĐỌC (readableBy) khỏi response.
 *  KHÔNG xoá khỏi DB — chỉ ẩn ở tầng API. */
function stripUnreadableFields(
  fields: EntityFieldDef[], data: Record<string, unknown>, role: Role,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    const f = fields.find((ff) => ff.name === k);
    if (!f) { out[k] = v; continue; }
    if (fieldCan(role, "read", f)) out[k] = v;
  }
  return out;
}

/** Kiểm unique cho các field đánh `unique: true`. Throw nếu trùng (không
 *  tính bản thân record đang update). Chạy ở app-layer (không Postgres
 *  partial unique index — lazy v2 nếu cần performance). */
async function assertUnique(
  db: DB, companyId: string, entityId: string, fields: EntityFieldDef[],
  data: Record<string, unknown>, excludeRecordId?: string,
): Promise<void> {
  for (const f of fields) {
    if (!f.unique) continue;
    if (!(f.name in data)) continue;
    const val = data[f.name];
    if (val == null || val === "") continue;
    const dup = await db.select({ id: entityRecords.id }).from(entityRecords)
      .where(and(
        eq(entityRecords.companyId, companyId),
        eq(entityRecords.entityId, entityId),
        sql`${entityRecords.deletedAt} IS NULL`,
        sql`${entityRecords.data}->>${f.name} = ${String(val)}`,
        excludeRecordId ? sql`${entityRecords.id} <> ${excludeRecordId}::uuid` : sql`true`,
      ))
      .limit(1);
    if (dup.length > 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Trùng giá trị unique: field "${f.label || f.name}" đã có record khác`,
      });
    }
  }
}

/** Deep equality nông cho JSONB primitive/object — dùng tính diff records.update.
   Đủ cho field cấp 1 (validateRecord chỉ sinh key phẳng); object/array so chuỗi
   JSON canonicalized không thực sự cần ở v1. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Đọc entity.meta.bindings[op]; trả tên procedure nếu prefix là "proc:".
   Null nếu không có binding hoặc là MCP/legacy. Dùng để records.* dispatch
   sang procedure-runner thay native Postgres query. */
async function resolveProcBinding(
  db: DB, companyId: string, entityId: string,
  op: "list" | "get" | "create" | "update" | "delete",
): Promise<string | null> {
  const [row] = await db.select({ meta: entities.meta }).from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.companyId, companyId)));
  const b = (row?.meta as { bindings?: Record<string, string> } | null)?.bindings?.[op];
  if (!b || typeof b !== "string") return null;
  return b.startsWith("proc:") ? b.slice(5).trim() : null;
}

/** Khi user tạo agent mới: tự động chèn họ vào `agent_members` với role=owner.
   Nhờ vậy user có quyền toggle private + thêm/xoá member sau này mà không cần
   admin can thiệp. Idempotent (ON CONFLICT DO NOTHING). */
async function autoAddOwner(db: DB, agentId: string, userId: string): Promise<void> {
  await db.insert(agentMembers).values({
    agentId, userId, role: "owner", addedBy: userId,
  }).onConflictDoNothing();
}

/* ─── AppRouter ──────────────────────────────────────────── */
export const appRouter = router({
  /* ── Xác thực ──
     Rate-limit: 5 lần / 15 phút / IP cho cả register và login (chống
     brute-force + spam first-admin slot khi DB reset). Vượt giới hạn →
     TRPCError code "TOO_MANY_REQUESTS". Lưu state in-memory (xem trpc.ts).
     Activity log: gọi logActivity cho register/login_success/login_failed/
     logout. login_failed có thể không có companyId nếu email lạ — fallback
     skip log (chỉ console.warn ở activity.ts catch). */
  auth: router({
    register: publicProcedure
      .use(rateLimit("auth.register", 5, 15 * 60 * 1000))
      .input(z.object({
        email: z.string().email(),
        name: z.string().min(1),
        password: z.string().min(8),
      }))
      .mutation(async ({ ctx, input }) => {
        const existing = await ctx.db.select({ id: users.id }).from(users).limit(1);
        if (existing.length > 0) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Đã có tài khoản — người quản trị tạo tài khoản mới.",
          });
        }
        const [u] = await ctx.db.insert(users).values({
          email: input.email,
          name: input.name,
          passwordHash: await hashPassword(input.password),
          role: "admin",
        }).returning();
        if (!u) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        // Công ty mặc định — tạo nếu chưa có, gắn user đầu tiên làm admin.
        await ctx.db.insert(companies)
          .values({ name: "Công ty của tôi", slug: "default" })
          .onConflictDoNothing({ target: companies.slug });
        const [co] = await ctx.db.select({ id: companies.id }).from(companies)
          .where(eq(companies.slug, "default"));
        if (co) {
          await ctx.db.insert(companyMembers)
            .values({ companyId: co.id, userId: u.id, role: "admin" })
            .onConflictDoNothing();
          await logActivity(ctx.db, {
            companyId: co.id,
            kind: "auth.register",
            objectType: "user",
            target: u.id,
            detail: `Tạo admin đầu tiên: ${u.email} (IP ${ctx.ip})`,
            actorUserId: u.id,
          });
        }
        return { id: u.id, email: u.email, role: u.role };
      }),

    login: publicProcedure
      .use(rateLimit("auth.login", 5, 15 * 60 * 1000))
      .input(z.object({ email: z.string().email(), password: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const [u] = await ctx.db.select().from(users)
          .where(eq(users.email, input.email));
        if (!u || !(await verifyPassword(input.password, u.passwordHash))) {
          // Log thất bại nếu user tồn tại (có company để gắn). Email lạ →
          // skip (không spam log với email tuỳ ý nhập sai).
          if (u) {
            const [m] = await ctx.db
              .select({ companyId: companyMembers.companyId })
              .from(companyMembers)
              .where(eq(companyMembers.userId, u.id)).limit(1);
            if (m) {
              await logActivity(ctx.db, {
                companyId: m.companyId,
                kind: "auth.login_failed",
                objectType: "user",
                target: u.id,
                detail: `Sai mật khẩu (email ${input.email}, IP ${ctx.ip})`,
                actorUserId: u.id,
              });
            }
          }
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Email hoặc mật khẩu không đúng",
          });
        }
        const token = newSessionToken();
        // Công ty mặc định của phiên = công ty đầu tiên user là thành viên.
        const [m] = await ctx.db
          .select({ companyId: companyMembers.companyId })
          .from(companyMembers)
          .where(eq(companyMembers.userId, u.id)).limit(1);
        await ctx.db.insert(sessions).values({
          id: token,
          userId: u.id,
          activeCompanyId: m?.companyId ?? null,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        });
        ctx.reply.setCookie(SESSION_COOKIE, token, {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          secure: process.env.NODE_ENV === "production",
          maxAge: Math.floor(SESSION_TTL_MS / 1000),
        });
        if (m) {
          await logActivity(ctx.db, {
            companyId: m.companyId,
            kind: "auth.login_success",
            objectType: "user",
            target: u.id,
            detail: `Đăng nhập thành công (IP ${ctx.ip})`,
            actorUserId: u.id,
          });
        }
        return { id: u.id, email: u.email, name: u.name, role: u.role };
      }),

    logout: protectedProcedure.mutation(async ({ ctx }) => {
      if (ctx.sessionToken) {
        await ctx.db.delete(sessions).where(eq(sessions.id, ctx.sessionToken));
      }
      ctx.reply.clearCookie(SESSION_COOKIE, { path: "/" });
      if (ctx.user?.companyId) {
        await logActivity(ctx.db, {
          companyId: ctx.user.companyId,
          kind: "auth.logout",
          objectType: "user",
          target: ctx.user.id,
          detail: `Đăng xuất (IP ${ctx.ip})`,
          actorUserId: ctx.user.id,
        });
      }
      return { ok: true };
    }),

    me: protectedProcedure.query(({ ctx }) => ctx.user),

    /** Preview thông tin invite — public (chưa login). Trả về email, name,
       company name để trang /invite hiển thị. KHÔNG trả về token. */
    invitePreview: publicProcedure
      .use(rateLimit("auth.invitePreview", 20, 15 * 60 * 1000))
      .input(z.object({ token: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const [inv] = await ctx.db.select({
          userId: userInvites.userId,
          companyId: userInvites.companyId,
          expiresAt: userInvites.expiresAt,
          acceptedAt: userInvites.acceptedAt,
        }).from(userInvites).where(eq(userInvites.token, input.token));
        if (!inv) {
          return { valid: false as const, reason: "not_found" as const };
        }
        if (inv.acceptedAt) {
          return { valid: false as const, reason: "accepted" as const };
        }
        if (inv.expiresAt < new Date()) {
          return { valid: false as const, reason: "expired" as const };
        }
        const [u] = await ctx.db.select({ email: users.email, name: users.name })
          .from(users).where(eq(users.id, inv.userId));
        const [co] = await ctx.db.select({ name: companies.name })
          .from(companies).where(eq(companies.id, inv.companyId));
        return {
          valid: true as const,
          email: u?.email ?? "",
          name: u?.name ?? "",
          companyName: co?.name ?? "",
          expiresAt: inv.expiresAt,
        };
      }),

    /** Accept invite: user đặt mật khẩu lần đầu, tạo session, set cookie.
       Cùng cơ chế rate-limit như login (chống brute-force token). */
    acceptInvite: publicProcedure
      .use(rateLimit("auth.acceptInvite", 5, 15 * 60 * 1000))
      .input(z.object({
        token: z.string().min(1),
        password: z.string().min(8),
      }))
      .mutation(async ({ ctx, input }) => {
        const [inv] = await ctx.db.select().from(userInvites)
          .where(eq(userInvites.token, input.token));
        if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Link không hợp lệ" });
        if (inv.acceptedAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Link đã được sử dụng" });
        }
        if (inv.expiresAt < new Date()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Link đã hết hạn" });
        }
        // Đặt password + đánh dấu invite accepted (cùng transaction logic).
        await ctx.db.update(users)
          .set({ passwordHash: await hashPassword(input.password) })
          .where(eq(users.id, inv.userId));
        await ctx.db.update(userInvites)
          .set({ acceptedAt: new Date() })
          .where(eq(userInvites.id, inv.id));

        // Tự cấp session — user vào app ngay, không cần qua màn login.
        const token = newSessionToken();
        await ctx.db.insert(sessions).values({
          id: token,
          userId: inv.userId,
          activeCompanyId: inv.companyId,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        });
        ctx.reply.setCookie(SESSION_COOKIE, token, {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          secure: process.env.NODE_ENV === "production",
          maxAge: Math.floor(SESSION_TTL_MS / 1000),
        });
        const [u] = await ctx.db.select().from(users)
          .where(eq(users.id, inv.userId));
        await logActivity(ctx.db, {
          companyId: inv.companyId,
          kind: "user.invite_accepted",
          objectType: "user",
          target: inv.userId,
          detail: `Chấp nhận lời mời, đặt mật khẩu (IP ${ctx.ip})`,
          actorUserId: inv.userId,
        });
        return {
          id: u?.id ?? inv.userId,
          email: u?.email ?? "",
          name: u?.name ?? "",
          role: u?.role ?? "viewer",
        };
      }),
  }),

  /* ── Entity (metadata) — lọc theo công ty đang chọn ── */
  entities: router({
    list: rbacProcedure("view", "entity")
      .query(({ ctx }) => ctx.db.select().from(entities)
        .where(eq(entities.companyId, ctx.user.companyId))),

    get: rbacProcedure("view", "entity")
      .input(z.string().uuid())
      .query(async ({ ctx, input }) => {
        const [row] = await ctx.db.select().from(entities)
          .where(and(eq(entities.id, input),
            eq(entities.companyId, ctx.user.companyId)));
        return row ?? null;
      }),

    // Upsert: id do client cấp → INSERT nếu chưa có, UPDATE nếu đã có
    // (chỉ trong phạm vi công ty — id của công ty khác bị từ chối).
    save: rbacProcedure("edit", "entity")
      .input(entityInput)
      .mutation(async ({ ctx, input }) => {
        const values = {
          name: input.name, label: input.label, icon: input.icon ?? null,
          fields: input.fields,
          ...(input.meta !== undefined ? { meta: input.meta } : {}),
        };
        if (input.id) {
          const [ex] = await ctx.db.select({ companyId: entities.companyId })
            .from(entities).where(eq(entities.id, input.id));
          if (ex && ex.companyId !== ctx.user.companyId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Đối tượng thuộc công ty khác" });
          }
          if (ex) {
            const [row] = await ctx.db.update(entities)
              .set({ ...values, updatedAt: new Date() })
              .where(eq(entities.id, input.id)).returning();
            return row;
          }
          const [row] = await ctx.db.insert(entities)
            .values({ id: input.id, companyId: ctx.user.companyId, ...values })
            .returning();
          return row;
        }
        const [row] = await ctx.db.insert(entities)
          .values({ companyId: ctx.user.companyId, ...values }).returning();
        return row;
      }),

    delete: rbacProcedure("delete", "entity")
      .input(z.string().uuid())
      .mutation(async ({ ctx, input }) => {
        await ctx.db.delete(entities).where(and(eq(entities.id, input),
          eq(entities.companyId, ctx.user.companyId)));
      }),
  }),

  /* ── Record (dữ liệu động) — lọc theo công ty đang chọn ──
     - Soft delete: delete = set deleted_at. hardDelete = thật sự xoá (admin).
     - Optimistic lock: update bắt buộc nhận expectedVersion (mặc định 0 cho
       legacy client), mismatch → CONFLICT 409.
     - Audit: mỗi update insert entity_record_versions với data + diff per-field.
     - Lifecycle: restore (đảo deleted_at), history (list version), revert (apply
       lại data của version cũ → tạo version mới). */
  records: router({
    list: rbacProcedure("view", "entity")
      .input(z.object({
        entityId: z.string().uuid(),
        query: queryParams,
        includeDeleted: z.boolean().optional(),
      }))
      .query(async ({ ctx, input }) => {
        // Procedure binding dispatch — nếu entity.meta.bindings.list = "proc:<name>",
        // delegate sang procedure-runner. Procedure phải trả { rows, total } | rows[].
        const proc = await resolveProcBinding(
          ctx.db, ctx.user.companyId, input.entityId, "list");
        if (proc) {
          const r = await makeInvokeProcedure({
            db: ctx.db, companyId: ctx.user.companyId,
            callTool: makeCallTool(ctx.db, ctx.user.companyId),
            actorUserId: ctx.user.id,
          })(proc, { query: input.query ?? {} });
          const out = r.output as { rows?: unknown[]; total?: number } | unknown[] | null;
          const rows = Array.isArray(out) ? out : (out?.rows ?? []);
          const total = Array.isArray(out) ? rows.length : (out?.total ?? rows.length);
          return { rows, total };
        }
        const where = buildRecordWhere(
          ctx.user.companyId, input.entityId, input.query, input.includeDeleted ?? false);
        let q = ctx.db.select().from(entityRecords).where(where).$dynamic();
        const sort = input.query?.sort;
        if (sort) {
          const dir = sort.dir === "desc" ? sql`desc` : sql`asc`;
          q = q.orderBy(sql`(${entityRecords.data}->>${sort.field}) ${dir}`);
        }
        const rows = await q
          .limit(input.query?.limit ?? 100)
          .offset(input.query?.offset ?? 0);
        const [c] = await ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(entityRecords).where(where);
        return { rows, total: c?.count ?? 0 };
      }),

    get: rbacProcedure("view", "entity")
      .input(z.string().uuid())
      .query(async ({ ctx, input }) => {
        // Trả cả khi soft-deleted để UI cho phép restore từ trang chi tiết.
        const [row] = await ctx.db.select().from(entityRecords)
          .where(and(eq(entityRecords.id, input),
            eq(entityRecords.companyId, ctx.user.companyId)));
        if (!row) return null;
        // Procedure get-binding: cho phép procedure decorate/enrich row trả về.
        const proc = await resolveProcBinding(
          ctx.db, ctx.user.companyId, row.entityId, "get");
        if (proc) {
          const r = await makeInvokeProcedure({
            db: ctx.db, companyId: ctx.user.companyId,
            callTool: makeCallTool(ctx.db, ctx.user.companyId),
            actorUserId: ctx.user.id,
          })(proc, { id: input, row });
          return r.output ?? row;
        }
        return row;
      }),

    create: rbacProcedure("create", "entity")
      .input(z.object({ entityId: z.string().uuid(), data: z.record(z.unknown()) }))
      .mutation(async ({ ctx, input }) => {
        const fields = await loadEntityFields(
          ctx.db, ctx.user.companyId, input.entityId);
        // Strip field user không có quyền write (field-level RBAC).
        const writable = stripUnwritableFields(fields, input.data, ctx.user.role);
        const data = assertValid(fields, writable, false);
        // Sinh value cho field type "sequence" — server-side, atomic.
        const [ent] = await ctx.db.select({ name: entities.name }).from(entities)
          .where(eq(entities.id, input.entityId));
        const entName = ent?.name ?? input.entityId;
        for (const f of fields) {
          if (f.type === "sequence" && data[f.name] == null) {
            data[f.name] = await nextSequence(ctx.db, ctx.user.companyId, entName, f);
          }
        }
        await assertUnique(ctx.db, ctx.user.companyId, input.entityId, fields, data);
        const [row] = await ctx.db.insert(entityRecords).values({
          companyId: ctx.user.companyId,
          entityId: input.entityId,
          data,
          createdBy: ctx.user.id,
        }).returning();
        if (!row) return row;
        // Ẩn field user không có quyền read trước khi trả response.
        return {
          ...row,
          data: stripUnreadableFields(fields, row.data as Record<string, unknown>, ctx.user.role),
        };
      }),

    update: rbacProcedure("edit", "entity")
      .input(z.object({
        recordId: z.string().uuid(),
        data: z.record(z.unknown()),
        expectedVersion: z.number().int().nonnegative().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Lấy state hiện tại để check version + tính diff.
        const [rec] = await ctx.db
          .select({
            entityId: entityRecords.entityId,
            data: entityRecords.data,
            version: entityRecords.version,
            deletedAt: entityRecords.deletedAt,
          })
          .from(entityRecords).where(and(eq(entityRecords.id, input.recordId),
            eq(entityRecords.companyId, ctx.user.companyId)));
        if (!rec) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Record không tồn tại" });
        }
        if (rec.deletedAt) {
          throw new TRPCError({ code: "BAD_REQUEST",
            message: "Record đã xoá — restore trước khi sửa" });
        }
        if (input.expectedVersion !== undefined && input.expectedVersion !== rec.version) {
          throw new TRPCError({ code: "CONFLICT",
            message: `Version mismatch: bạn đang sửa bản v${input.expectedVersion}, hiện tại đã là v${rec.version}` });
        }
        const fields = await loadEntityFields(
          ctx.db, ctx.user.companyId, rec.entityId);
        // Strip field user không có quyền write trước khi validate.
        const writable = stripUnwritableFields(fields, input.data, ctx.user.role);
        const data = assertValid(fields, writable, true);
        // Sequence không cho update — bỏ key sequence ra khỏi data.
        for (const f of fields) {
          if (f.type === "sequence") delete data[f.name];
        }
        await assertUnique(ctx.db, ctx.user.companyId, rec.entityId, fields, data, input.recordId);

        // Tính diff per-field (cũ vs mới) — chỉ trên field có trong patch.
        const oldData = (rec.data ?? {}) as Record<string, unknown>;
        const diff: Record<string, { old: unknown; new: unknown }> = {};
        for (const [k, v] of Object.entries(data)) {
          if (!deepEqual(oldData[k], v)) diff[k] = { old: oldData[k] ?? null, new: v };
        }

        // Merge JSONB + tăng version atomic. Audit version ghi sau khi update OK.
        const [row] = await ctx.db.update(entityRecords).set({
          data: sql`${entityRecords.data} || ${JSON.stringify(data)}::jsonb`,
          version: rec.version + 1,
          updatedAt: new Date(),
        }).where(and(eq(entityRecords.id, input.recordId),
          eq(entityRecords.companyId, ctx.user.companyId))).returning();

        // Ghi audit version (best-effort: lỗi không rollback update).
        if (row && Object.keys(diff).length > 0) {
          try {
            await ctx.db.insert(entityRecordVersions).values({
              companyId: ctx.user.companyId,
              recordId: input.recordId,
              version: row.version,
              data: row.data as Record<string, unknown>,
              diff,
              actorUserId: ctx.user.id,
            });
          } catch (e) {
            console.error("[records.update] ghi version lỗi:", (e as Error).message);
          }
        }
        return row;
      }),

    delete: rbacProcedure("delete", "entity")
      .input(z.string().uuid())
      .mutation(async ({ ctx, input }) => {
        // Cascade: scan các entity khác có lookup/multi-lookup trỏ tới
        // record này, áp dụng onDelete behavior (restrict/setnull/cascade).
        await applyCascadeOnDelete(
          ctx.db, ctx.user.companyId, input, ctx.user.id);
        // SOFT delete bản thân: set deleted_at; data còn nguyên cho restore.
        await ctx.db.update(entityRecords)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(entityRecords.id, input),
            eq(entityRecords.companyId, ctx.user.companyId)));
      }),

    backRefs: rbacProcedure("view", "entity")
      .input(z.string().uuid())
      .query(async ({ ctx, input }) => {
        // Trả danh sách entity-source + count + sampleIds cho các record
        // active có field lookup/multi-lookup trỏ tới recordId này.
        return scanBackRefs(ctx.db, ctx.user.companyId, input);
      }),

    restore: rbacProcedure("edit", "entity")
      .input(z.string().uuid())
      .mutation(async ({ ctx, input }) => {
        await ctx.db.update(entityRecords)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(and(eq(entityRecords.id, input),
            eq(entityRecords.companyId, ctx.user.companyId)));
        return { ok: true };
      }),

    hardDelete: rbacProcedure("delete", "entity")
      .input(z.string().uuid())
      .mutation(async ({ ctx, input }) => {
        // Xoá thật sự — cascade xoá luôn entity_record_versions (FK cascade).
        // Yêu cầu thêm: chỉ admin mới được xoá vĩnh viễn.
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN",
            message: "Chỉ admin được xoá vĩnh viễn (hardDelete)" });
        }
        await ctx.db.delete(entityRecords).where(and(eq(entityRecords.id, input),
          eq(entityRecords.companyId, ctx.user.companyId)));
      }),

    history: rbacProcedure("view", "entity")
      .input(z.string().uuid())
      .query(async ({ ctx, input }) => {
        // Verify record thuộc đúng công ty trước khi trả version list.
        const [rec] = await ctx.db.select({ id: entityRecords.id }).from(entityRecords)
          .where(and(eq(entityRecords.id, input),
            eq(entityRecords.companyId, ctx.user.companyId)));
        if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "Record không tồn tại" });
        return ctx.db.select().from(entityRecordVersions)
          .where(and(eq(entityRecordVersions.recordId, input),
            eq(entityRecordVersions.companyId, ctx.user.companyId)))
          .orderBy(desc(entityRecordVersions.version));
      }),

    revert: rbacProcedure("edit", "entity")
      .input(z.object({
        recordId: z.string().uuid(),
        targetVersion: z.number().int().nonnegative(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Lấy snapshot của version đích.
        const [target] = await ctx.db.select().from(entityRecordVersions)
          .where(and(
            eq(entityRecordVersions.recordId, input.recordId),
            eq(entityRecordVersions.companyId, ctx.user.companyId),
            eq(entityRecordVersions.version, input.targetVersion)));
        if (!target) {
          throw new TRPCError({ code: "NOT_FOUND",
            message: `Không tìm thấy version ${input.targetVersion}` });
        }
        const [cur] = await ctx.db.select({
          version: entityRecords.version,
          data: entityRecords.data,
        }).from(entityRecords).where(and(eq(entityRecords.id, input.recordId),
          eq(entityRecords.companyId, ctx.user.companyId)));
        if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Record không tồn tại" });

        // Replace toàn bộ data (không merge — revert là thay nguyên khối).
        const targetData = target.data as Record<string, unknown>;
        const oldData = (cur.data ?? {}) as Record<string, unknown>;
        const diff: Record<string, { old: unknown; new: unknown }> = {};
        const allKeys = new Set([...Object.keys(oldData), ...Object.keys(targetData)]);
        for (const k of allKeys) {
          if (!deepEqual(oldData[k], targetData[k])) {
            diff[k] = { old: oldData[k] ?? null, new: targetData[k] ?? null };
          }
        }
        const [row] = await ctx.db.update(entityRecords).set({
          data: targetData,
          version: cur.version + 1,
          updatedAt: new Date(),
        }).where(and(eq(entityRecords.id, input.recordId),
          eq(entityRecords.companyId, ctx.user.companyId))).returning();

        if (row) {
          try {
            await ctx.db.insert(entityRecordVersions).values({
              companyId: ctx.user.companyId,
              recordId: input.recordId,
              version: row.version,
              data: targetData,
              diff,
              actorUserId: ctx.user.id,
            });
          } catch (e) {
            console.error("[records.revert] ghi version lỗi:", (e as Error).message);
          }
        }
        return row;
      }),

    /* ── Bulk operations — cap 1000 ids/rows/lần. Lớn hơn → async job.
       Mỗi op write tạo audit version riêng. Báo cáo per-item errors. */
    bulkUpdate: rbacProcedure("edit", "entity")
      .input(z.object({
        entityId: z.string().uuid(),
        ids: z.array(z.string().uuid()).min(1).max(1000),
        patch: z.record(z.unknown()),
      }))
      .mutation(async ({ ctx, input }) => {
        const fields = await loadEntityFields(
          ctx.db, ctx.user.companyId, input.entityId);
        const data = assertValid(fields, input.patch, true);
        let updated = 0;
        const errors: Array<{ id: string; message: string }> = [];
        for (const id of input.ids) {
          try {
            const [cur] = await ctx.db.select({
              data: entityRecords.data, version: entityRecords.version,
              deletedAt: entityRecords.deletedAt,
            }).from(entityRecords).where(and(
              eq(entityRecords.id, id),
              eq(entityRecords.companyId, ctx.user.companyId),
              eq(entityRecords.entityId, input.entityId),
            ));
            if (!cur || cur.deletedAt) { errors.push({ id, message: "Không tồn tại hoặc đã xoá" }); continue; }
            const oldData = (cur.data ?? {}) as Record<string, unknown>;
            const diff: Record<string, { old: unknown; new: unknown }> = {};
            for (const [k, v] of Object.entries(data)) {
              if (!deepEqual(oldData[k], v)) diff[k] = { old: oldData[k] ?? null, new: v };
            }
            const [row] = await ctx.db.update(entityRecords).set({
              data: sql`${entityRecords.data} || ${JSON.stringify(data)}::jsonb`,
              version: cur.version + 1,
              updatedAt: new Date(),
            }).where(eq(entityRecords.id, id)).returning();
            if (row && Object.keys(diff).length > 0) {
              await ctx.db.insert(entityRecordVersions).values({
                companyId: ctx.user.companyId,
                recordId: id, version: row.version,
                data: row.data as Record<string, unknown>,
                diff, actorUserId: ctx.user.id,
              });
            }
            updated += 1;
          } catch (e) {
            errors.push({ id, message: (e as Error).message });
          }
        }
        return { updated, errors };
      }),

    bulkDelete: rbacProcedure("delete", "entity")
      .input(z.object({
        entityId: z.string().uuid(),
        ids: z.array(z.string().uuid()).min(1).max(1000),
      }))
      .mutation(async ({ ctx, input }) => {
        let deleted = 0;
        const errors: Array<{ id: string; message: string }> = [];
        for (const id of input.ids) {
          try {
            await applyCascadeOnDelete(ctx.db, ctx.user.companyId, id, ctx.user.id);
            await ctx.db.update(entityRecords)
              .set({ deletedAt: new Date(), updatedAt: new Date() })
              .where(and(
                eq(entityRecords.id, id),
                eq(entityRecords.companyId, ctx.user.companyId),
              ));
            deleted += 1;
          } catch (e) {
            errors.push({ id, message: (e as Error).message });
          }
        }
        return { deleted, errors };
      }),

    bulkImport: rbacProcedure("create", "entity")
      .input(z.object({
        entityId: z.string().uuid(),
        rows: z.array(z.record(z.unknown())).min(1).max(1000),
      }))
      .mutation(async ({ ctx, input }) => {
        const fields = await loadEntityFields(
          ctx.db, ctx.user.companyId, input.entityId);
        let imported = 0;
        const errors: Array<{ index: number; message: string }> = [];
        for (let i = 0; i < input.rows.length; i++) {
          try {
            const r = input.rows[i]!;
            const v = validateRecord(fields, r, { registry: pluginRegistry });
            if (!v.ok) {
              errors.push({ index: i,
                message: v.errors.map((e) => `${e.field}: ${e.message}`).join("; ") });
              continue;
            }
            await ctx.db.insert(entityRecords).values({
              companyId: ctx.user.companyId,
              entityId: input.entityId,
              data: v.data,
              createdBy: ctx.user.id,
            });
            imported += 1;
          } catch (e) {
            errors.push({ index: i, message: (e as Error).message });
          }
        }
        return { imported, errors };
      }),

    export: rbacProcedure("view", "entity")
      .input(z.object({
        entityId: z.string().uuid(),
        format: z.enum(["csv", "json"]),
        query: queryParams,
      }))
      .query(async ({ ctx, input }) => {
        const where = buildRecordWhere(
          ctx.user.companyId, input.entityId, input.query, false);
        const rows = await ctx.db.select().from(entityRecords)
          .where(where).limit(5000);
        if (input.format === "json") {
          return { format: "json" as const, content: JSON.stringify(rows.map((r) => r.data), null, 2) };
        }
        // CSV: collect headers từ tất cả keys, escape RFC 4180 (quote tất cả).
        const allKeys = new Set<string>();
        for (const r of rows) {
          for (const k of Object.keys((r.data ?? {}) as Record<string, unknown>)) {
            allKeys.add(k);
          }
        }
        const headers = [...allKeys];
        const esc = (v: unknown): string => {
          if (v == null) return "";
          const s = typeof v === "string" ? v : JSON.stringify(v);
          return `"${s.replace(/"/g, '""')}"`;
        };
        const body = rows.map((r) => {
          const d = (r.data ?? {}) as Record<string, unknown>;
          return headers.map((h) => esc(d[h])).join(",");
        }).join("\n");
        const content = headers.map((h) => `"${h}"`).join(",") + "\n" + body;
        return { format: "csv" as const, content };
      }),
  }),

  /* ── Workflow — lọc theo công ty đang chọn ── */
  workflows: router({
    list: rbacProcedure("view", "workflow")
      .query(({ ctx }) => ctx.db.select().from(workflows)
        .where(eq(workflows.companyId, ctx.user.companyId))),

    get: rbacProcedure("view", "workflow")
      .input(z.string().uuid())
      .query(async ({ ctx, input }) => {
        const [row] = await ctx.db.select().from(workflows)
          .where(and(eq(workflows.id, input),
            eq(workflows.companyId, ctx.user.companyId)));
        return row ?? null;
      }),

    save: rbacProcedure("edit", "workflow")
      .input(workflowInput)
      .mutation(async ({ ctx, input }) => {
        const values = {
          name: input.name,
          triggerType: input.triggerType ?? "manual",
          ...(input.graph !== undefined ? { graph: input.graph } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        };
        if (input.id) {
          const [row] = await ctx.db.update(workflows)
            .set({ ...values, updatedAt: new Date() })
            .where(and(eq(workflows.id, input.id),
              eq(workflows.companyId, ctx.user.companyId))).returning();
          if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Workflow không tồn tại" });
          return row;
        }
        const [row] = await ctx.db.insert(workflows)
          .values({ companyId: ctx.user.companyId, ...values }).returning();
        return row;
      }),

    delete: rbacProcedure("delete", "workflow")
      .input(z.string().uuid())
      .mutation(async ({ ctx, input }) => {
        await ctx.db.delete(workflows).where(and(eq(workflows.id, input),
          eq(workflows.companyId, ctx.user.companyId)));
      }),

    // Publish: chốt bản nháp graph hiện tại → publishedGraph (runner chạy bản này).
    publish: rbacProcedure("edit", "workflow")
      .input(z.string().uuid())
      .mutation(async ({ ctx, input }) => {
        const [wf] = await ctx.db.select({ name: workflows.name, graph: workflows.graph })
          .from(workflows).where(and(eq(workflows.id, input),
            eq(workflows.companyId, ctx.user.companyId)));
        if (!wf) throw new TRPCError({ code: "NOT_FOUND", message: "Workflow không tồn tại" });
        await ctx.db.update(workflows)
          .set({ publishedGraph: wf.graph, updatedAt: new Date() })
          .where(eq(workflows.id, input));
        // Audit khi publish workflow chứa code-node — code chạy in-process,
        // mức rủi ro cao hơn action thường, cần truy vết được người publish.
        const graph = wf.graph as { nodes?: Array<{ data?: { kind?: string } }> } | null;
        const codeCount = (graph?.nodes ?? []).filter((n) => n?.data?.kind === "code").length;
        if (codeCount > 0) {
          await logActivity(ctx.db, {
            companyId: ctx.user.companyId,
            kind: "publish_workflow_with_code",
            objectType: "workflow",
            target: wf.name,
            detail: `Publish workflow có ${codeCount} code-node`,
            actorUserId: ctx.user.id,
          });
        }
        return { ok: true };
      }),

    // Chạy workflow ngay (đồng bộ). pg-boss để chạy nền/cron là bước kế.
    trigger: rbacProcedure("run", "workflow")
      .input(z.object({
        workflowId: z.string().uuid(),
        context: z.record(z.unknown()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const r = await executeWorkflow(ctx.db, input.workflowId, {
          context: input.context,
          companyId: ctx.user.companyId,
        });
        return { runId: r.runId, status: r.status };
      }),

    // Lịch sử các lần chạy gần đây của một workflow.
    runs: rbacProcedure("view", "workflow")
      .input(z.string().uuid())
      .query(({ ctx, input }) => recentRuns(ctx.db, input, ctx.user.companyId)),
  }),

  /* ── Lịch chạy workflow (cron) — pg-boss quét bảng này ── */
  schedules: router({
    list: rbacProcedure("view", "workflow")
      .query(({ ctx }) => ctx.db.select().from(schedules)
        .where(eq(schedules.companyId, ctx.user.companyId))),

    save: rbacProcedure("edit", "workflow")
      .input(scheduleInput)
      .mutation(async ({ ctx, input }) => {
        // Workflow của lịch phải thuộc công ty đang chọn.
        const [wf] = await ctx.db.select({ id: workflows.id }).from(workflows)
          .where(and(eq(workflows.id, input.workflowId),
            eq(workflows.companyId, ctx.user.companyId)));
        if (!wf) throw new TRPCError({ code: "NOT_FOUND", message: "Workflow không tồn tại" });
        const values = {
          workflowId: input.workflowId,
          cronExpr: input.cronExpr,
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        };
        if (input.id) {
          const [ex] = await ctx.db.select({ companyId: schedules.companyId })
            .from(schedules).where(eq(schedules.id, input.id));
          if (ex && ex.companyId !== ctx.user.companyId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Lịch thuộc công ty khác" });
          }
          if (ex) {
            const [row] = await ctx.db.update(schedules).set(values)
              .where(eq(schedules.id, input.id)).returning();
            return row;
          }
          const [row] = await ctx.db.insert(schedules)
            .values({ id: input.id, companyId: ctx.user.companyId, ...values })
            .returning();
          return row;
        }
        const [row] = await ctx.db.insert(schedules)
          .values({ companyId: ctx.user.companyId, ...values }).returning();
        return row;
      }),

    delete: rbacProcedure("delete", "workflow")
      .input(z.string().uuid())
      .mutation(async ({ ctx, input }) => {
        await ctx.db.delete(schedules).where(and(eq(schedules.id, input),
          eq(schedules.companyId, ctx.user.companyId)));
      }),
  }),

  /* ── Page (metadata low-code) — lọc theo công ty đang chọn ── */
  pages: router({
    list: rbacProcedure("view", "page")
      .query(({ ctx }) => ctx.db.select().from(pages)
        .where(eq(pages.companyId, ctx.user.companyId))),

    get: rbacProcedure("view", "page")
      .input(z.string().uuid())
      .query(async ({ ctx, input }) => {
        const [row] = await ctx.db.select().from(pages)
          .where(and(eq(pages.id, input),
            eq(pages.companyId, ctx.user.companyId)));
        return row ?? null;
      }),

    // Upsert: id do client cấp → INSERT nếu chưa có, UPDATE nếu đã có
    // (chỉ trong phạm vi công ty — id của công ty khác bị từ chối).
    save: rbacProcedure("edit", "page")
      .input(pageInput)
      .mutation(async ({ ctx, input }) => {
        const values = {
          name: input.name, label: input.label, icon: input.icon ?? null,
          content: input.content ?? {},
        };
        if (input.id) {
          const [ex] = await ctx.db.select({ companyId: pages.companyId })
            .from(pages).where(eq(pages.id, input.id));
          if (ex && ex.companyId !== ctx.user.companyId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Đối tượng thuộc công ty khác" });
          }
          if (ex) {
            const [row] = await ctx.db.update(pages)
              .set({ ...values, updatedAt: new Date() })
              .where(eq(pages.id, input.id)).returning();
            return row;
          }
          const [row] = await ctx.db.insert(pages)
            .values({ id: input.id, companyId: ctx.user.companyId, ...values })
            .returning();
          return row;
        }
        const [row] = await ctx.db.insert(pages)
          .values({ companyId: ctx.user.companyId, ...values }).returning();
        return row;
      }),

    delete: rbacProcedure("delete", "page")
      .input(z.string().uuid())
      .mutation(async ({ ctx, input }) => {
        await ctx.db.delete(pages).where(and(eq(pages.id, input),
          eq(pages.companyId, ctx.user.companyId)));
      }),
  }),

  /* ── Agent (metadata low-code) — lọc theo công ty đang chọn ── */
  /* Lớp phân quyền: RBAC company-wide cho list/create; agent-level ACL
     (xem agent-acl.ts) cho get/save(update)/delete + member CRUD. */
  agents: router({
    list: rbacProcedure("view", "agent")
      .query(({ ctx }) => ctx.db.select().from(agents)
        .where(eq(agents.companyId, ctx.user.companyId))),

    /* Get: per-agent view check (private agent → chỉ member; open → company-RBAC). */
    get: protectedProcedure
      .input(z.string().uuid())
      .query(async ({ ctx, input }) => {
        await assertCanActOnAgent(ctx, input, "view");
        const [row] = await ctx.db.select().from(agents)
          .where(eq(agents.id, input));
        return row ?? null;
      }),

    /* Save: tách CREATE vs UPDATE.
       - CREATE: dùng RBAC company-edit. Người tạo TỰ ĐỘNG trở thành owner
         trong agent_members để có quyền toggle private + thêm member sau.
       - UPDATE: ACL "edit" per-agent. */
    save: protectedProcedure
      .input(agentInput)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
        if (!ctx.user.companyId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Chưa thuộc công ty nào" });
        }
        const values = {
          name: input.name, model: input.model,
          ...(input.config !== undefined ? { config: input.config } : {}),
          ...(input.managerId !== undefined ? { managerId: input.managerId } : {}),
        };
        if (input.id) {
          const [ex] = await ctx.db.select({ companyId: agents.companyId })
            .from(agents).where(eq(agents.id, input.id));
          if (ex && ex.companyId !== ctx.user.companyId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Đối tượng thuộc công ty khác" });
          }
          if (ex) {
            await assertCanActOnAgent(ctx, input.id, "edit");
            const [row] = await ctx.db.update(agents)
              .set({ ...values, updatedAt: new Date() })
              .where(eq(agents.id, input.id)).returning();
            await logActivity(ctx.db, {
              companyId: ctx.user.companyId,
              kind: "agent.updated",
              objectType: "agent",
              target: input.id,
              detail: `Cập nhật agent "${input.name}"`,
              actorUserId: ctx.user.id,
            });
            return row;
          }
          // Insert với id sẵn → kiểm tra quyền create (company-RBAC).
          if (!ctx.user.role || ctx.user.role === "viewer") {
            throw new TRPCError({ code: "FORBIDDEN", message: "Không có quyền tạo agent" });
          }
          const [row] = await ctx.db.insert(agents)
            .values({
              id: input.id, companyId: ctx.user.companyId,
              createdBy: ctx.user.id,
              ...values,
            }).returning();
          if (row) await autoAddOwner(ctx.db, row.id, ctx.user.id);
          return row;
        }
        // Tạo mới (không id) — company-RBAC create.
        if (!ctx.user.role || ctx.user.role === "viewer") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Không có quyền tạo agent" });
        }
        const [row] = await ctx.db.insert(agents)
          .values({
            companyId: ctx.user.companyId,
            createdBy: ctx.user.id,
            ...values,
          }).returning();
        if (row) await autoAddOwner(ctx.db, row.id, ctx.user.id);
        return row;
      }),

    delete: protectedProcedure
      .input(z.string().uuid())
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user?.companyId) throw new TRPCError({ code: "FORBIDDEN" });
        await assertCanActOnAgent(ctx, input, "delete");
        const [row] = await ctx.db.select({ name: agents.name }).from(agents)
          .where(eq(agents.id, input));
        await ctx.db.delete(agents).where(and(eq(agents.id, input),
          eq(agents.companyId, ctx.user.companyId)));
        await logActivity(ctx.db, {
          companyId: ctx.user.companyId,
          kind: "agent.deleted",
          objectType: "agent",
          target: input,
          detail: `Xoá agent "${row?.name ?? input}"`,
          actorUserId: ctx.user.id,
        });
      }),

    /* Trả về 7 template memory mặc định cho UI dùng làm nội dung
       "Khôi phục mặc định". Đã nhúng tên agent vào template. */
    memoryTemplates: rbacProcedure("view", "agent")
      .input(z.string().uuid())
      .query(async ({ ctx, input }) => {
        await assertCanActOnAgent(ctx, input, "view");
        const [a] = await ctx.db.select().from(agents).where(and(
          eq(agents.id, input),
          eq(agents.companyId, ctx.user.companyId),
        ));
        if (!a) throw new TRPCError({ code: "NOT_FOUND" });
        return allDefaultTemplates(a.name);
      }),

    /* ── User ↔ Agent membership (N:M) ── */

    /** Đặt agent chính của user hiện tại (hoặc null để bỏ chọn). */
    setPrimary: protectedProcedure
      .input(z.object({ agentId: z.string().uuid().nullable() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
        if (input.agentId) {
          await assertCanActOnAgent(ctx, input.agentId, "chat");
        }
        await ctx.db.update(users)
          .set({ primaryAgentId: input.agentId })
          .where(eq(users.id, ctx.user.id));
        if (ctx.user.companyId) {
          await logActivity(ctx.db, {
            companyId: ctx.user.companyId,
            kind: "user.set_primary_agent",
            objectType: "user",
            target: ctx.user.id,
            detail: input.agentId
              ? `Đặt agent chính = ${input.agentId}`
              : "Gỡ agent chính",
            actorUserId: ctx.user.id,
          });
        }
        return { ok: true };
      }),

    /** Lấy primary + danh sách (agent_id, role) của user hiện tại. */
    myAgents: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
      const [me] = await ctx.db.select({ primaryAgentId: users.primaryAgentId })
        .from(users).where(eq(users.id, ctx.user.id));
      const members = await ctx.db.select({
        agentId: agentMembers.agentId,
        role: agentMembers.role,
      }).from(agentMembers).where(eq(agentMembers.userId, ctx.user.id));
      return {
        primaryAgentId: me?.primaryAgentId ?? null,
        members,
      };
    }),

    /** Danh sách thành viên của 1 agent (JOIN với users để hiện name/email). */
    listMembers: protectedProcedure
      .input(z.string().uuid())
      .query(async ({ ctx, input }) => {
        await assertCanActOnAgent(ctx, input, "view");
        return ctx.db.select({
          userId: agentMembers.userId,
          role: agentMembers.role,
          addedBy: agentMembers.addedBy,
          addedAt: agentMembers.addedAt,
          userName: users.name,
          userEmail: users.email,
        })
          .from(agentMembers)
          .leftJoin(users, eq(agentMembers.userId, users.id))
          .where(eq(agentMembers.agentId, input));
      }),

    /** Thêm hoặc đổi role của 1 member. Cần quyền manage_members (owner). */
    addMember: protectedProcedure
      .input(z.object({
        agentId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(["owner", "operator", "observer"]),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user?.companyId) throw new TRPCError({ code: "FORBIDDEN" });
        await assertCanActOnAgent(ctx, input.agentId, "manage_members");
        // Member phải thuộc cùng công ty với agent.
        const [m] = await ctx.db.select({ companyId: companyMembers.companyId })
          .from(companyMembers)
          .where(and(
            eq(companyMembers.userId, input.userId),
            eq(companyMembers.companyId, ctx.user.companyId),
          ));
        if (!m) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "User không phải thành viên công ty này",
          });
        }
        await ctx.db.insert(agentMembers).values({
          agentId: input.agentId,
          userId: input.userId,
          role: input.role,
          addedBy: ctx.user.id,
        }).onConflictDoUpdate({
          target: [agentMembers.agentId, agentMembers.userId],
          set: { role: input.role, addedBy: ctx.user.id, addedAt: new Date() },
        });
        await logActivity(ctx.db, {
          companyId: ctx.user.companyId,
          kind: "agent.member_added",
          objectType: "agent",
          target: input.agentId,
          detail: `Thêm/đổi thành viên ${input.userId} role=${input.role}`,
          actorUserId: ctx.user.id,
        });
        return { ok: true };
      }),

    /** Gỡ 1 member khỏi agent. */
    removeMember: protectedProcedure
      .input(z.object({
        agentId: z.string().uuid(),
        userId: z.string().uuid(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user?.companyId) throw new TRPCError({ code: "FORBIDDEN" });
        await assertCanActOnAgent(ctx, input.agentId, "manage_members");
        await ctx.db.delete(agentMembers)
          .where(and(
            eq(agentMembers.agentId, input.agentId),
            eq(agentMembers.userId, input.userId),
          ));
        await logActivity(ctx.db, {
          companyId: ctx.user.companyId,
          kind: "agent.member_removed",
          objectType: "agent",
          target: input.agentId,
          detail: `Gỡ thành viên ${input.userId}`,
          actorUserId: ctx.user.id,
        });
        return { ok: true };
      }),
  }),

  /* ── Đa công ty ── */
  companies: companiesRouter,

  /* ── Heartbeat — agent tự thức dậy theo lịch ── */
  heartbeats: heartbeatsRouter,

  /* ── Entity Sync — đồng bộ MCP → entity_records theo lịch ── */
  entitySync: entitySyncRouter,

  /* ── Governance — phê duyệt nhiều tầng ── */
  governance: governanceRouter,

  /* ── Plugin registry — đăng ký/bật-tắt plugin theo công ty ── */
  plugins: pluginsRouter,

  /* ── Procedure registry — native JS procedure (thay stored proc MSSQL) ── */
  procedures: proceduresRouter,

  /* ── Enum registry — reusable option set đa ngôn ngữ ── */
  enums: enumsRouter,

  /* ── Embed — token nhúng builder ── */
  embed: embedRouter,

  /* ── Knowledge Base — nạp tri thức + tra cứu RAG ── */
  knowledge: knowledgeRouter,

  /* ── IoT — thiết bị gửi/nhận dữ liệu (REST riêng ở /iot/v1) ── */
  iot: iotRouter,

  /* ── Backup — sao lưu DB + sync uploads lên Google Drive ── */
  backup: backupRouter,

  /* ── Xuất/nhập cấu hình (entity+page+workflow+agent) ── */
  transfer: router({
    export: rbacProcedure("view", "settings")
      .query(({ ctx }) => exportBundle(ctx.db, ctx.user.companyId)),
    import: rbacProcedure("edit", "settings")
      .input(z.object({
        entities: z.array(z.record(z.unknown())).optional(),
        pages: z.array(z.record(z.unknown())).optional(),
        workflows: z.array(z.record(z.unknown())).optional(),
        agents: z.array(z.record(z.unknown())).optional(),
      }))
      .mutation(({ ctx, input }) => importBundle(ctx.db, ctx.user.companyId, input)),
  }),

  /* ── Ngân sách — hạn mức chi phí tháng + chặn cứng (theo công ty) ── */
  budget: router({
    get: rbacProcedure("view", "activity").query(async ({ ctx }) => ({
      monthlyUsd: (await getBudget(ctx.db, ctx.user.companyId)).monthlyUsd,
      usedUsd: await monthUsageUsd(ctx.db, ctx.user.companyId),
    })),
    save: rbacProcedure("edit", "settings")
      .input(z.object({ monthlyUsd: z.number().nonnegative() }))
      .mutation(async ({ ctx, input }) => {
        await setBudget(ctx.db, ctx.user.companyId, input.monthlyUsd);
        return { ok: true };
      }),
  }),

  /* ── Nhật ký hành động (activity_log) — lọc theo công ty ── */
  activity: router({
    list: rbacProcedure("view", "activity")
      .query(({ ctx }) => ctx.db.select().from(activityLog)
        .where(eq(activityLog.companyId, ctx.user.companyId))
        .orderBy(desc(activityLog.at)).limit(200)),
    clear: rbacProcedure("delete", "activity")
      .mutation(async ({ ctx }) => {
        await ctx.db.delete(activityLog)
          .where(eq(activityLog.companyId, ctx.user.companyId));
        return { ok: true };
      }),
  }),

  /* ── Cấu hình MCP (theo công ty) ── */
  mcp: router({
    get: rbacProcedure("view", "settings").query(async ({ ctx }) => {
      const [row] = await ctx.db.select().from(mcpConfigs)
        .where(and(eq(mcpConfigs.companyId, ctx.user.companyId),
          eq(mcpConfigs.name, "default")));
      return row?.config ?? null;
    }),
    save: rbacProcedure("edit", "settings")
      .input(z.object({ config: z.record(z.unknown()) }))
      .mutation(async ({ ctx, input }) => {
        const [ex] = await ctx.db.select({ id: mcpConfigs.id })
          .from(mcpConfigs).where(and(eq(mcpConfigs.name, "default"),
            eq(mcpConfigs.companyId, ctx.user.companyId)));
        if (ex) {
          await ctx.db.update(mcpConfigs).set({ config: input.config })
            .where(eq(mcpConfigs.id, ex.id));
        } else {
          await ctx.db.insert(mcpConfigs)
            .values({ companyId: ctx.user.companyId, name: "default", config: input.config });
        }
        return { ok: true };
      }),
  }),

  /* ── LLM profiles (theo công ty) ── */
  /* CHỈ profile chat (kind='chat'). Profile embedding của Knowledge
     Base cũng nằm chung bảng llm_profiles (kind='embedding') — phải
     lọc kind để nó KHÔNG lọt vào danh sách model chat / AgentPanel. */
  llm: router({
    list: rbacProcedure("view", "settings")
      .query(async ({ ctx }) => {
        const rows = await ctx.db.select().from(llmProfiles)
          .where(and(eq(llmProfiles.companyId, ctx.user.companyId),
            eq(llmProfiles.kind, "chat")));
        // Giải mã apiKey để client nạp lại profile.
        return rows.map((r) => ({
          ...r,
          apiKeyEnc: r.apiKeyEnc ? decryptSecret(r.apiKeyEnc) : null,
        }));
      }),
    save: rbacProcedure("edit", "settings")
      .input(z.object({
        name: z.string().min(1),
        adapter: z.string(),
        model: z.string(),
        endpoint: z.string().optional(),
        apiKeyEnc: z.string().optional(),
        temperature: z.number().optional(),
        maxTokens: z.number().int().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const [ex] = await ctx.db.select({ id: llmProfiles.id })
          .from(llmProfiles).where(and(eq(llmProfiles.name, input.name),
            eq(llmProfiles.companyId, ctx.user.companyId),
            eq(llmProfiles.kind, "chat")));
        const values = {
          adapter: input.adapter,
          model: input.model,
          endpoint: input.endpoint ?? null,
          apiKeyEnc: input.apiKeyEnc ? encryptSecret(input.apiKeyEnc) : null,
          temperature: input.temperature ?? 0.7,
          maxTokens: input.maxTokens ?? 4096,
        };
        if (ex) {
          await ctx.db.update(llmProfiles).set(values)
            .where(eq(llmProfiles.id, ex.id));
        } else {
          await ctx.db.insert(llmProfiles)
            .values({ companyId: ctx.user.companyId, name: input.name, kind: "chat", ...values });
        }
        return { ok: true };
      }),
    delete: rbacProcedure("edit", "settings")
      .input(z.string().min(1))
      .mutation(async ({ ctx, input }) => {
        await ctx.db.delete(llmProfiles).where(and(eq(llmProfiles.name, input),
          eq(llmProfiles.companyId, ctx.user.companyId),
          eq(llmProfiles.kind, "chat")));
      }),
  }),
});

export type AppRouter = typeof appRouter;
