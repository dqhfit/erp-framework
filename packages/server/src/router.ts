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
  entities, entityRecords, users, sessions, mcpConfigs, llmProfiles,
  pages, agents, agentMembers, workflows, schedules, activityLog,
  companies, companyMembers, userInvites,
} from "@erp-framework/db";
import { validateRecord, pluginRegistry, type EntityFieldDef } from "@erp-framework/core";
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
}).optional();
type QueryParamsInput = z.infer<typeof queryParams>;

/* Dựng WHERE cho record động. Toán tử khoảng cần expression
   index mới nhanh — xem UPGRADE-PLAN 3.5. */
function buildRecordWhere(
  companyId: string,
  entityId: string,
  query: QueryParamsInput,
): SQL | undefined {
  const conds: SQL[] = [
    eq(entityRecords.companyId, companyId),
    eq(entityRecords.entityId, entityId),
  ];
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

  /* ── Record (dữ liệu động) — lọc theo công ty đang chọn ── */
  records: router({
    list: rbacProcedure("view", "entity")
      .input(z.object({ entityId: z.string().uuid(), query: queryParams }))
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
          ctx.user.companyId, input.entityId, input.query);
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
        const data = assertValid(fields, input.data, false);
        const [row] = await ctx.db.insert(entityRecords).values({
          companyId: ctx.user.companyId,
          entityId: input.entityId,
          data,
          createdBy: ctx.user.id,
        }).returning();
        return row;
      }),

    update: rbacProcedure("edit", "entity")
      .input(z.object({ recordId: z.string().uuid(), data: z.record(z.unknown()) }))
      .mutation(async ({ ctx, input }) => {
        const [rec] = await ctx.db
          .select({ entityId: entityRecords.entityId })
          .from(entityRecords).where(and(eq(entityRecords.id, input.recordId),
            eq(entityRecords.companyId, ctx.user.companyId)));
        if (!rec) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Record không tồn tại" });
        }
        const fields = await loadEntityFields(
          ctx.db, ctx.user.companyId, rec.entityId);
        const data = assertValid(fields, input.data, true);
        // Merge NÔNG bằng toán tử jsonb `||` — CÓ CHỦ ĐÍCH, không
        // phải thiếu sót: record là tập field phẳng (validateRecord
        // chỉ sinh key cấp 1). Update từng phần = thay trọn giá trị
        // các field có mặt trong input, giữ nguyên field vắng mặt.
        // Field kiểu `json` là MỘT giá trị → thay nguyên khối, không
        // trộn sâu, đúng ngữ nghĩa "một field một giá trị".
        const [row] = await ctx.db.update(entityRecords).set({
          data: sql`${entityRecords.data} || ${JSON.stringify(data)}::jsonb`,
          updatedAt: new Date(),
        }).where(and(eq(entityRecords.id, input.recordId),
          eq(entityRecords.companyId, ctx.user.companyId))).returning();
        return row;
      }),

    delete: rbacProcedure("delete", "entity")
      .input(z.string().uuid())
      .mutation(async ({ ctx, input }) => {
        await ctx.db.delete(entityRecords).where(and(eq(entityRecords.id, input),
          eq(entityRecords.companyId, ctx.user.companyId)));
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
