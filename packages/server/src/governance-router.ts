/* ==========================================================
   governance-router.ts — Phê duyệt nhiều tầng (governance).
   - list   : yêu cầu phê duyệt của công ty
   - create : tạo yêu cầu phê duyệt
   - decide : một người duyệt/từ chối; đủ số tầng → approved
   Đa tầng: requiredApprovals = số phê duyệt cần đạt. Một người
   chỉ quyết định một lần; bị từ chối → rejected ngay.
   ========================================================== */
import { z } from "zod";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { approvalRequests } from "@erp-framework/db";
import { router, rbacProcedure } from "./trpc";

interface Decision {
  userId: string;
  decision: "approve" | "reject";
  comment: string;
  at: string;
}

export const governanceRouter = router({
  list: rbacProcedure("view", "activity")
    .input(z.object({
      status: z.enum(["pending", "approved", "rejected"]).optional(),
    }).optional())
    .query(({ ctx, input }) => {
      const conds: SQL[] = [eq(approvalRequests.companyId, ctx.user.companyId)];
      if (input?.status) conds.push(eq(approvalRequests.status, input.status));
      return ctx.db.select().from(approvalRequests)
        .where(and(...conds))
        .orderBy(desc(approvalRequests.createdAt));
    }),

  create: rbacProcedure("view", "activity")
    .input(z.object({
      title: z.string().min(1),
      detail: z.string().optional(),
      kind: z.string().optional(),
      requiredApprovals: z.number().int().positive().max(20).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db.insert(approvalRequests).values({
        companyId: ctx.user.companyId,
        title: input.title,
        detail: input.detail ?? "",
        kind: input.kind ?? "general",
        requiredApprovals: input.requiredApprovals ?? 1,
        createdBy: ctx.user.id,
      }).returning();
      return row;
    }),

  decide: rbacProcedure("edit", "settings")
    .input(z.object({
      id: z.string().uuid(),
      decision: z.enum(["approve", "reject"]),
      comment: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [req] = await ctx.db.select().from(approvalRequests)
        .where(and(eq(approvalRequests.id, input.id),
          eq(approvalRequests.companyId, ctx.user.companyId)));
      if (!req) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Yêu cầu không tồn tại" });
      }
      if (req.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Yêu cầu đã được quyết định" });
      }
      const decisions = ((req.decisions as Decision[] | null) ?? []).slice();
      if (decisions.some((d) => d.userId === ctx.user.id)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Bạn đã quyết định yêu cầu này rồi" });
      }
      decisions.push({
        userId: ctx.user.id,
        decision: input.decision,
        comment: input.comment ?? "",
        at: new Date().toISOString(),
      });
      const approvals = decisions.filter((d) => d.decision === "approve").length;
      let status: "pending" | "approved" | "rejected" = "pending";
      if (input.decision === "reject") status = "rejected";
      else if (approvals >= req.requiredApprovals) status = "approved";
      const [row] = await ctx.db.update(approvalRequests).set({
        decisions,
        status,
        decidedAt: status === "pending" ? null : new Date(),
      }).where(eq(approvalRequests.id, req.id)).returning();
      return row;
    }),
});
