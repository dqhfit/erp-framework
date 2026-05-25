/* ==========================================================
   router.ts — tRPC AppRouter.
   - auth.*       : đăng ký / đăng nhập / đăng xuất / thông tin
   - entities.*   : CRUD metadata entity         (RBAC)
   - records.*    : CRUD dữ liệu động            (RBAC + validate-on-write)
   - workflows.*  : trigger workflow             (RBAC)
   ========================================================== */
import { z } from "zod";
import { and, eq, sql, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  entities, entityRecords, workflowVersions, workflowRuns,
  users, sessions, mcpConfigs, llmProfiles,
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
import { recordsRouter } from "./records-router";
import { toolsRouter } from "./tools-router";
import { proceduresRouter } from "./procedures-router";
import { enumsRouter } from "./enums-router";
import { savedViewsRouter } from "./saved-views-router";
import { recordCommentsRouter } from "./record-comments-router";
import { entityWebhooksRouter } from "./entity-webhooks-router";
import { apiKeysRouter } from "./api-keys-router";
import { materializedViewsRouter } from "./materialized-views-router";
import { entityTemplatesRouter } from "./entity-templates-router";
import { notificationsRouter } from "./notifications-router";
import { feedbackRouter } from "./feedback-router";
import { presenceRouter } from "./presence-router";
import { fieldOpsRouter } from "./field-ops-router";
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
import { executeWorkflow, recentRuns } from "./run-workflow";
import { allDefaultTemplates } from "./agent-memory";
import {
  entityInput, pageInput, agentInput, workflowInput, scheduleInput,
  autoAddOwner,
} from "./router-helpers";

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

    /* Safe field rename — cập nhật entities.fields[].name + di trú
       data: jsonb_set new key từ old key + xoá old key. Atomic per-row,
       không transaction lớn (giữ unblocked). */
    renameField: rbacProcedure("edit", "entity")
      .input(z.object({
        entityId: z.string().uuid(),
        oldKey: z.string().min(1),
        newKey: z.string().regex(/^[a-z_][a-z0-9_]*$/i,
          "newKey phải là identifier (chữ/số/_)"),
      }))
      .mutation(async ({ ctx, input }) => {
        const [ent] = await ctx.db.select().from(entities).where(and(
          eq(entities.id, input.entityId),
          eq(entities.companyId, ctx.user.companyId),
        ));
        if (!ent) throw new TRPCError({ code: "NOT_FOUND", message: "Entity không tồn tại" });
        const fields = (ent.fields ?? []) as EntityFieldDef[];
        if (!fields.find((f) => f.name === input.oldKey)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Field "${input.oldKey}" không có` });
        }
        if (fields.find((f) => f.name === input.newKey)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Field "${input.newKey}" đã tồn tại` });
        }
        // Update fields[] — đổi name.
        const newFields = fields.map((f) =>
          f.name === input.oldKey ? { ...f, name: input.newKey } : f);
        await ctx.db.update(entities)
          .set({ fields: newFields, updatedAt: new Date() })
          .where(eq(entities.id, input.entityId));
        // Migrate data: di chuyển value từ old key sang new key trong mỗi record.
        // jsonb_set(jsonb #- '{oldKey}', '{newKey}', data->'oldKey')
        await ctx.db.execute(sql`
          UPDATE entity_records SET
            data = jsonb_set(data - ${input.oldKey}, ARRAY[${input.newKey}],
              COALESCE(data->${input.oldKey}, 'null'::jsonb)),
            updated_at = now()
          WHERE entity_id = ${input.entityId}::uuid
            AND company_id = ${ctx.user.companyId}::uuid
            AND data ? ${input.oldKey}
        `);
        return { ok: true, migrated: newFields };
      }),

    /* Field type change — load record, coerce mỗi giá trị field qua
       validate. Báo cáo errors[] cho record không coerce được. v1 sửa
       record OK + skip lỗi (user xem rồi quyết định). */
    changeFieldType: rbacProcedure("edit", "entity")
      .input(z.object({
        entityId: z.string().uuid(),
        fieldName: z.string().min(1),
        newType: z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        const [ent] = await ctx.db.select().from(entities).where(and(
          eq(entities.id, input.entityId),
          eq(entities.companyId, ctx.user.companyId),
        ));
        if (!ent) throw new TRPCError({ code: "NOT_FOUND", message: "Entity không tồn tại" });
        const fields = (ent.fields ?? []) as EntityFieldDef[];
        const oldField = fields.find((f) => f.name === input.fieldName);
        if (!oldField) throw new TRPCError({ code: "BAD_REQUEST", message: "Field không có" });
        const newField: EntityFieldDef = { ...oldField, type: input.newType };
        // Coerce thử trên các record (chỉ 1 field) + report.
        const recs = await ctx.db.select({ id: entityRecords.id, data: entityRecords.data })
          .from(entityRecords).where(and(
            eq(entityRecords.entityId, input.entityId),
            eq(entityRecords.companyId, ctx.user.companyId),
          ));
        let migrated = 0;
        const errors: Array<{ id: string; oldValue: unknown; message: string }> = [];
        for (const r of recs) {
          const data = (r.data ?? {}) as Record<string, unknown>;
          if (!(input.fieldName in data)) continue;
          const v = validateRecord([newField], { [input.fieldName]: data[input.fieldName] },
            { registry: pluginRegistry });
          if (!v.ok) {
            errors.push({ id: r.id, oldValue: data[input.fieldName],
              message: v.errors.map((e) => e.message).join("; ") });
            continue;
          }
          if (v.data[input.fieldName] !== data[input.fieldName]) {
            data[input.fieldName] = v.data[input.fieldName];
            await ctx.db.update(entityRecords).set({ data, updatedAt: new Date() })
              .where(eq(entityRecords.id, r.id));
          }
          migrated += 1;
        }
        // Update entity fields metadata.
        const newFields = fields.map((f) =>
          f.name === input.fieldName ? newField : f);
        await ctx.db.update(entities)
          .set({ fields: newFields, updatedAt: new Date() })
          .where(eq(entities.id, input.entityId));
        return { migrated, errors };
      }),
  }),

  /* ── Record (dữ liệu động) — lọc theo công ty đang chọn ──
     - Soft delete: delete = set deleted_at. hardDelete = thật sự xoá (admin).
     - Optimistic lock: update bắt buộc nhận expectedVersion (mặc định 0 cho
       legacy client), mismatch → CONFLICT 409.
     - Audit: mỗi update insert entity_record_versions với data + diff per-field.
     - Lifecycle: restore (đảo deleted_at), history (list version), revert (apply
       lại data của version cũ → tạo version mới). */
  records: recordsRouter,

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
    // V6: snapshot vào workflow_versions với weight 100; A/B test bằng cách
    // publish thêm version với label khác + chỉnh weight.
    publish: rbacProcedure("edit", "workflow")
      .input(z.object({
        id: z.string().uuid(),
        label: z.string().optional(),
        weight: z.number().int().min(0).max(100).optional(),
      }).or(z.string().uuid().transform((id) => ({ id, label: undefined, weight: undefined }))))
      .mutation(async ({ ctx, input }) => {
        const [wf] = await ctx.db.select({ name: workflows.name, graph: workflows.graph })
          .from(workflows).where(and(eq(workflows.id, input.id),
            eq(workflows.companyId, ctx.user.companyId)));
        if (!wf) throw new TRPCError({ code: "NOT_FOUND", message: "Workflow không tồn tại" });
        await ctx.db.update(workflows)
          .set({ publishedGraph: wf.graph, updatedAt: new Date() })
          .where(eq(workflows.id, input.id));
        // Snapshot vào workflow_versions — nextVersion = max + 1.
        const [last] = await ctx.db.select({ version: workflowVersions.version })
          .from(workflowVersions)
          .where(eq(workflowVersions.workflowId, input.id))
          .orderBy(desc(workflowVersions.version)).limit(1);
        const nextVersion = (last?.version ?? 0) + 1;
        await ctx.db.insert(workflowVersions).values({
          companyId: ctx.user.companyId,
          workflowId: input.id,
          version: nextVersion,
          label: input.label ?? `v${nextVersion}`,
          graph: wf.graph as Record<string, unknown>,
          weight: input.weight ?? 100,
          active: true,
          publishedBy: ctx.user.id,
        });
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
        return { ok: true, version: nextVersion };
      }),

    // List versions với weight + active flag — UI A/B config.
    listVersions: rbacProcedure("view", "workflow")
      .input(z.string().uuid())
      .query(({ ctx, input }) =>
        ctx.db.select().from(workflowVersions).where(and(
          eq(workflowVersions.workflowId, input),
          eq(workflowVersions.companyId, ctx.user.companyId),
        )).orderBy(desc(workflowVersions.version))),

    setVersionWeight: rbacProcedure("edit", "workflow")
      .input(z.object({
        versionId: z.string().uuid(),
        weight: z.number().int().min(0).max(100),
        active: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db.update(workflowVersions).set({
          weight: input.weight,
          ...(input.active !== undefined ? { active: input.active } : {}),
        }).where(and(
          eq(workflowVersions.id, input.versionId),
          eq(workflowVersions.companyId, ctx.user.companyId),
        ));
        return { ok: true };
      }),

    /* Replay từ step k — chạy lại workflow dùng vars snapshot tại step k.
       Dùng cho debug "tại sao step này fail" — lặp nhanh fix node bug. */
    replay: rbacProcedure("run", "workflow")
      .input(z.object({
        runId: z.string().uuid(),
        fromStep: z.number().int().nonnegative().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const [run] = await ctx.db.select().from(workflowRuns).where(and(
          eq(workflowRuns.id, input.runId),
          eq(workflowRuns.companyId, ctx.user.companyId),
        ));
        if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Run không tồn tại" });
        // Lấy vars snapshot trước step fromStep (hoặc initialVars nếu 0).
        // (run.steps có thể dùng v2 để rebuild vars precise per step.)
        const idx = input.fromStep ?? 0;
        const replayVars: Record<string, unknown> = { ...(run.vars as Record<string, unknown> ?? {}) };
        // (Reconstruct vars trước step idx bằng output các step trước —
        // approx vì server không lưu snapshot từng step; v1 dùng vars cuối.)
        const r = await executeWorkflow(ctx.db, run.workflowId, {
          context: replayVars,
          companyId: ctx.user.companyId,
        });
        return { runId: r.runId, status: r.status, stepCount: r.stepCount, replayedFrom: idx };
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

  /* ── Tool registry — artifact ngoài monorepo (D:\code\cowok\Tools\*).
       Khác plugin: là ứng dụng độc lập (web-app/mcp-server/cli/plugin),
       có manifest, discover qua auto-scan + registerRemote URL. ── */
  tools: toolsRouter,

  /* ── Procedure registry — native JS procedure (thay stored proc MSSQL) ── */
  procedures: proceduresRouter,

  /* ── Enum registry — reusable option set đa ngôn ngữ ── */
  enums: enumsRouter,

  /* ── Saved views — per-user query + columns combo cho entity ── */
  savedViews: savedViewsRouter,

  /* ── Record comments + replies (collaboration) ── */
  recordComments: recordCommentsRouter,

  /* ── Entity webhooks — outgoing HTTP POST trên record event ── */
  entityWebhooks: entityWebhooksRouter,

  /* ── API keys — cho REST /api/v1/* endpoints ── */
  apiKeys: apiKeysRouter,

  /* ── Materialized views — pre-computed query cache cho dashboard ── */
  materializedViews: materializedViewsRouter,

  /* ── Entity templates — print/email Mustache-like ── */
  entityTemplates: entityTemplatesRouter,

  /* ── Notifications (in-app, @mentions) ── */
  notifications: notificationsRouter,

  /* ── Feedback — user báo bất cập + đề xuất cải thiện ── */
  feedback: feedbackRouter,

  /* ── Presence "đang xem" per record ── */
  presence: presenceRouter,

  /* ── Real-time co-edit OT ops cho text field ── */
  fieldOps: fieldOpsRouter,

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
