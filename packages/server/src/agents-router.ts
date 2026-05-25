/* ==========================================================
   agents-router.ts — Agent CRUD + membership + memory templates.
   Tách khỏi router.ts (Sprint 1 P2.8 step 7).
   ========================================================== */

import { agentMembers, agents, companyMembers, users } from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { logActivity } from "./activity";
import { assertCanActOnAgent } from "./agent-acl";
import { allDefaultTemplates } from "./agent-memory";
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

  /** Lấy primary + danh sách (agent_id, role) của user hiện tại. */
  myAgents: approvedProcedure.query(async ({ ctx }) => {
    if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
    const [me] = await ctx.db
      .select({ primaryAgentId: users.primaryAgentId })
      .from(users)
      .where(eq(users.id, ctx.user.id));
    const members = await ctx.db
      .select({
        agentId: agentMembers.agentId,
        role: agentMembers.role,
      })
      .from(agentMembers)
      .where(eq(agentMembers.userId, ctx.user.id));
    return {
      primaryAgentId: me?.primaryAgentId ?? null,
      members,
    };
  }),

  /** Danh sách thành viên của 1 agent (JOIN với users để hiện name/email). */
  listMembers: approvedProcedure.input(z.string().uuid()).query(async ({ ctx, input }) => {
    await assertCanActOnAgent(ctx, input, "view");
    return ctx.db
      .select({
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
      await ctx.db
        .insert(agentMembers)
        .values({
          agentId: input.agentId,
          userId: input.userId,
          role: input.role,
          addedBy: ctx.user.id,
        })
        .onConflictDoUpdate({
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
      await ctx.db
        .delete(agentMembers)
        .where(and(eq(agentMembers.agentId, input.agentId), eq(agentMembers.userId, input.userId)));
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
});
