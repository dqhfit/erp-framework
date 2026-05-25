/* ==========================================================
   router.ts — tRPC AppRouter.
   - auth.*       : đăng ký / đăng nhập / đăng xuất / thông tin
   - entities.*   : CRUD metadata entity         (RBAC)
   - records.*    : CRUD dữ liệu động            (RBAC + validate-on-write)
   - workflows.*  : trigger workflow             (RBAC)
   ========================================================== */
import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  users, sessions, mcpConfigs, llmProfiles, activityLog,
  companies, companyMembers, userInvites, inviteLinks,
} from "@erp-framework/db";
import { router, publicProcedure, protectedProcedure, rbacProcedure, rateLimit } from "./trpc";
import { logActivity } from "./activity";
import { companiesRouter } from "./companies-router";
import { heartbeatsRouter } from "./heartbeats-router";
import { entitySyncRouter } from "./entity-sync-router";
import { governanceRouter } from "./governance-router";
import { pluginsRouter } from "./plugins-router";
import { recordsRouter } from "./records-router";
import { entitiesRouter } from "./entities-router";
import { workflowsRouter } from "./workflows-router";
import { schedulesRouter } from "./schedules-router";
import { pagesRouter } from "./pages-router";
import { agentsRouter } from "./agents-router";
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

    /** Preview generic invite link -- public. Tra ve companyName + role. */
    inviteLinkPreview: publicProcedure
      .use(rateLimit("auth.inviteLinkPreview", 20, 15 * 60 * 1000))
      .input(z.object({ token: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const [link] = await ctx.db.select({
          companyId: inviteLinks.companyId,
          role: inviteLinks.role,
          expiresAt: inviteLinks.expiresAt,
          usedAt: inviteLinks.usedAt,
        }).from(inviteLinks).where(eq(inviteLinks.token, input.token));
        if (!link) return { valid: false as const, reason: "not_found" as const };
        if (link.usedAt) return { valid: false as const, reason: "used" as const };
        if (link.expiresAt < new Date()) return { valid: false as const, reason: "expired" as const };
        const [co] = await ctx.db.select({ name: companies.name })
          .from(companies).where(eq(companies.id, link.companyId));
        return {
          valid: true as const,
          companyName: co?.name ?? "",
          role: link.role,
          expiresAt: link.expiresAt,
        };
      }),

    /** Dang ky qua generic invite link: user tu nhap ten + email + mat khau.
       Server tao user moi, gan vao cong ty, cap session, mark link da dung. */
    acceptInviteLink: publicProcedure
      .use(rateLimit("auth.acceptInviteLink", 5, 15 * 60 * 1000))
      .input(z.object({
        token: z.string().min(1),
        name: z.string().min(1, "Vui lòng nhập họ tên"),
        email: z.string().email("Email không hợp lệ"),
        password: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự"),
      }))
      .mutation(async ({ ctx, input }) => {
        const [link] = await ctx.db.select().from(inviteLinks)
          .where(eq(inviteLinks.token, input.token));
        if (!link) throw new TRPCError({ code: "NOT_FOUND", message: "Link không hợp lệ" });
        if (link.usedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Link đã được sử dụng" });
        if (link.expiresAt < new Date()) throw new TRPCError({ code: "BAD_REQUEST", message: "Link đã hết hạn" });
        // Kiem tra email chua ton tai.
        const [existing] = await ctx.db.select({ id: users.id })
          .from(users).where(eq(users.email, input.email));
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "Email đã được dùng bởi tài khoản khác" });
        // Tao user moi.
        const passwordHash = await hashPassword(input.password);
        const [newUser] = await ctx.db.insert(users).values({
          email: input.email,
          name: input.name,
          passwordHash,
          role: link.role,
        }).returning();
        if (!newUser) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        // Gan vao cong ty.
        await ctx.db.insert(companyMembers).values({
          companyId: link.companyId,
          userId: newUser.id,
          role: link.role,
        });
        // Danh dau link da dung (1 lan).
        await ctx.db.update(inviteLinks)
          .set({ usedAt: new Date(), usedBy: newUser.id })
          .where(eq(inviteLinks.id, link.id));
        // Cap session tu dong.
        const sessionToken = newSessionToken();
        await ctx.db.insert(sessions).values({
          id: sessionToken,
          userId: newUser.id,
          activeCompanyId: link.companyId,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        });
        ctx.reply.setCookie(SESSION_COOKIE, sessionToken, {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          secure: process.env.NODE_ENV === "production",
          maxAge: Math.floor(SESSION_TTL_MS / 1000),
        });
        await logActivity(ctx.db, {
          companyId: link.companyId,
          kind: "user.invite_accepted",
          objectType: "user",
          target: newUser.id,
          detail: `Đăng ký qua invite link (IP ${ctx.ip})`,
          actorUserId: newUser.id,
        });
        return { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role };
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
  /* ── Entity metadata — CRUD definition (low-code designer) ── */
  entities: entitiesRouter,

  /* ── Record (dữ liệu động) ── */
  records: recordsRouter,

  /* ── Workflow — lọc theo công ty đang chọn ── */
  workflows: workflowsRouter,

  /* ── Schedule (cron) cho workflow ── */
  schedules: schedulesRouter,

  /* ── Page metadata (low-code designer) ── */
  pages: pagesRouter,

  /* ── Agent CRUD + membership + memory templates ── */
  agents: agentsRouter,


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
