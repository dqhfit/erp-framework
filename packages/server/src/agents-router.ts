/* ==========================================================
   agents-router.ts — Agent CRUD + membership + memory templates.
   Tách khỏi router.ts (Sprint 1 P2.8 step 7).
   ========================================================== */

import { agents, companyMembers, resourceMembers, users } from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { logActivity } from "./activity";
import { assertCanActOnAgent } from "./agent-acl";
import { allDefaultTemplates } from "./agent-memory";
import { AGENT_TEMPLATES } from "./agent-templates";
import { listResourceMembers, removeResourceMember, upsertResourceMember } from "./resource-acl";
import { agentInput, autoAddOwner } from "./router-helpers";
import { approvedProcedure, rbacProcedure, router } from "./trpc";

export const agentsRouter = router({
  list: rbacProcedure("view", "agent").query(({ ctx }) =>
    ctx.db.select().from(agents).where(eq(agents.companyId, ctx.user.companyId)),
  ),

  /* Get: per-agent view check (private agent → chỉ member; open → company-RBAC). */
  get: approvedProcedure.input(z.string().uuid()).query(async ({ ctx, input }) => {
    await assertCanActOnAgent(ctx, input, "view");
    const [row] = await ctx.db.select().from(agents).where(eq(agents.id, input));
    return row ?? null;
  }),

  /* Save: tách CREATE vs UPDATE.
       - CREATE: dùng RBAC company-edit. Người tạo TỰ ĐỘNG trở thành owner
         trong agent_members để có quyền toggle private + thêm member sau.
       - UPDATE: ACL "edit" per-agent. */
  save: approvedProcedure.input(agentInput).mutation(async ({ ctx, input }) => {
    if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
    if (!ctx.user.companyId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Chưa thuộc công ty nào" });
    }
    const values = {
      name: input.name,
      model: input.model,
      ...(input.config !== undefined ? { config: input.config } : {}),
      ...(input.managerId !== undefined ? { managerId: input.managerId } : {}),
    };
    if (input.id) {
      const [ex] = await ctx.db
        .select({ companyId: agents.companyId })
        .from(agents)
        .where(eq(agents.id, input.id));
      if (ex && ex.companyId !== ctx.user.companyId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Đối tượng thuộc công ty khác" });
      }
      if (ex) {
        await assertCanActOnAgent(ctx, input.id, "edit");
        const [row] = await ctx.db
          .update(agents)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(agents.id, input.id))
          .returning();
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
      const [row] = await ctx.db
        .insert(agents)
        .values({
          id: input.id,
          companyId: ctx.user.companyId,
          createdBy: ctx.user.id,
          ...values,
        })
        .returning();
      if (row) await autoAddOwner(ctx.db, row.id, ctx.user.id);
      return row;
    }
    // Tạo mới (không id) — company-RBAC create.
    if (!ctx.user.role || ctx.user.role === "viewer") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Không có quyền tạo agent" });
    }
    const [row] = await ctx.db
      .insert(agents)
      .values({
        companyId: ctx.user.companyId,
        createdBy: ctx.user.id,
        ...values,
      })
      .returning();
    if (row) await autoAddOwner(ctx.db, row.id, ctx.user.id);
    return row;
  }),

  delete: approvedProcedure.input(z.string().uuid()).mutation(async ({ ctx, input }) => {
    if (!ctx.user?.companyId) throw new TRPCError({ code: "FORBIDDEN" });
    await assertCanActOnAgent(ctx, input, "delete");
    const [row] = await ctx.db
      .select({ name: agents.name })
      .from(agents)
      .where(eq(agents.id, input));
    await ctx.db
      .delete(agents)
      .where(and(eq(agents.id, input), eq(agents.companyId, ctx.user.companyId)));
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
      const [a] = await ctx.db
        .select()
        .from(agents)
        .where(and(eq(agents.id, input), eq(agents.companyId, ctx.user.companyId)));
      if (!a) throw new TRPCError({ code: "NOT_FOUND" });
      return allDefaultTemplates(a.name);
    }),

  /* ── User ↔ Agent membership (N:M) ── */

  /** Đặt agent chính của user hiện tại (hoặc null để bỏ chọn). */
  setPrimary: approvedProcedure
    .input(z.object({ agentId: z.string().uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
      if (input.agentId) {
        await assertCanActOnAgent(ctx, input.agentId, "chat");
      }
      await ctx.db
        .update(users)
        .set({ primaryAgentId: input.agentId })
        .where(eq(users.id, ctx.user.id));
      if (ctx.user.companyId) {
        await logActivity(ctx.db, {
          companyId: ctx.user.companyId,
          kind: "user.set_primary_agent",
          objectType: "user",
          target: ctx.user.id,
          detail: input.agentId ? `Đặt agent chính = ${input.agentId}` : "Gỡ agent chính",
          actorUserId: ctx.user.id,
        });
      }
      return { ok: true };
    }),

  /** Lấy primary + danh sách (agent_id, role) của user hiện tại.
   *  Đọc từ resource_members (P2.3) — JOIN agents để filter theo company. */
  myAgents: approvedProcedure.query(async ({ ctx }) => {
    if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
    const [me] = await ctx.db
      .select({ primaryAgentId: users.primaryAgentId })
      .from(users)
      .where(eq(users.id, ctx.user.id));
    // resource_members + JOIN agents (filter company) — đảm bảo không
    // leak member của agent công ty khác (theoretically đã guard ở
    // addMember nhưng defensive).
    const rows = await ctx.db
      .select({
        agentId: resourceMembers.resourceId,
        role: resourceMembers.role,
      })
      .from(resourceMembers)
      .innerJoin(agents, eq(agents.id, resourceMembers.resourceId))
      .where(
        and(
          eq(resourceMembers.resourceType, "agent"),
          eq(resourceMembers.userId, ctx.user.id),
          eq(agents.companyId, ctx.user.companyId),
        ),
      );
    return {
      primaryAgentId: me?.primaryAgentId ?? null,
      members: rows,
    };
  }),

  /** Danh sách thành viên của 1 agent. Đọc từ resource_members (P2.3),
   *  JOIN users để hiện name/email. */
  listMembers: approvedProcedure.input(z.string().uuid()).query(async ({ ctx, input }) => {
    await assertCanActOnAgent(ctx, input, "view");
    const members = await listResourceMembers(ctx.db, "agent", input);
    if (members.length === 0) return [];
    // Resolve user info — 1 query batch thay vì JOIN (resource_members
    // không có FK chéo nên Drizzle không sinh được join).
    const userIds = members.map((m) => m.userId);
    const userRows = await ctx.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, userIds));
    const userMap = new Map(userRows.map((u) => [u.id, u]));
    return members.map((m) => ({
      ...m,
      userName: userMap.get(m.userId)?.name ?? null,
      userEmail: userMap.get(m.userId)?.email ?? null,
    }));
  }),

  /** Thêm hoặc đổi role của 1 member. Cần quyền manage_members (owner). */
  addMember: approvedProcedure
    .input(
      z.object({
        agentId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(["owner", "operator", "observer"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user?.companyId) throw new TRPCError({ code: "FORBIDDEN" });
      await assertCanActOnAgent(ctx, input.agentId, "manage_members");
      // Member phải thuộc cùng công ty với agent.
      const [m] = await ctx.db
        .select({ companyId: companyMembers.companyId })
        .from(companyMembers)
        .where(
          and(
            eq(companyMembers.userId, input.userId),
            eq(companyMembers.companyId, ctx.user.companyId),
          ),
        );
      if (!m) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User không phải thành viên công ty này",
        });
      }
      await upsertResourceMember(
        ctx.db,
        "agent",
        input.agentId,
        input.userId,
        input.role,
        ctx.user.id,
      );
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
  removeMember: approvedProcedure
    .input(
      z.object({
        agentId: z.string().uuid(),
        userId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user?.companyId) throw new TRPCError({ code: "FORBIDDEN" });
      await assertCanActOnAgent(ctx, input.agentId, "manage_members");
      await removeResourceMember(ctx.db, "agent", input.agentId, input.userId);
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

  /** Danh sach template agent theo phong ban — khong luu DB, la hang so server. */
  listTemplates: approvedProcedure.query(() => AGENT_TEMPLATES),

  /** Tao agent moi tu template. Luu templateId vao config de UI biet nguon goc. */
  instantiateTemplate: rbacProcedure("create", "agent")
    .input(z.object({ templateId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tpl = AGENT_TEMPLATES.find((t) => t.id === input.templateId);
      if (!tpl) throw new TRPCError({ code: "NOT_FOUND", message: "Template khong ton tai" });
      const [row] = await ctx.db
        .insert(agents)
        .values({
          companyId: ctx.user.companyId,
          createdBy: ctx.user.id,
          name: tpl.name,
          model: tpl.model,
          config: {
            templateId: tpl.id,
            systemPrompt: tpl.systemPrompt,
            tools: tpl.tools,
            temperature: tpl.temperature,
            isPrivate: false,
            memory: {},
            fallbackModels: [],
          },
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Insert that bai" });
      await autoAddOwner(ctx.db, row.id, ctx.user.id);
      await logActivity(ctx.db, {
        companyId: ctx.user.companyId,
        kind: "agent.created",
        objectType: "agent",
        target: row.id,
        detail: `Tao agent tu template "${tpl.id}"`,
        actorUserId: ctx.user.id,
      });
      return row;
    }),

  /** Cap nhat config agent hien tai theo template moi nhat (giu memory, ghi de systemPrompt/tools/temperature/model). */
  applyTemplate: rbacProcedure("edit", "agent")
    .input(z.object({ agentId: z.string().uuid(), templateId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tpl = AGENT_TEMPLATES.find((t) => t.id === input.templateId);
      if (!tpl) throw new TRPCError({ code: "NOT_FOUND", message: "Template khong ton tai" });
      await assertCanActOnAgent(ctx, input.agentId, "edit");
      const [existing] = await ctx.db
        .select({ config: agents.config })
        .from(agents)
        .where(and(eq(agents.id, input.agentId), eq(agents.companyId, ctx.user.companyId)));
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      const prevCfg = (existing.config ?? {}) as Record<string, unknown>;
      const [row] = await ctx.db
        .update(agents)
        .set({
          model: tpl.model,
          config: {
            ...prevCfg,
            templateId: tpl.id,
            systemPrompt: tpl.systemPrompt,
            tools: tpl.tools,
            temperature: tpl.temperature,
          },
          updatedAt: new Date(),
        })
        .where(eq(agents.id, input.agentId))
        .returning();
      await logActivity(ctx.db, {
        companyId: ctx.user.companyId,
        kind: "agent.updated",
        objectType: "agent",
        target: input.agentId,
        detail: `Cap nhat agent tu template "${tpl.id}"`,
        actorUserId: ctx.user.id,
      });
      return row;
    }),
});
