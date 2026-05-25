/* ==========================================================
   schedules-router.ts — Schedule (cron) cho workflow.
   pg-boss quét bảng schedules mỗi phút, enqueue workflow-run khi tới hạn.
   Tách khỏi router.ts (Sprint 1 P2.8 step 5).
   ========================================================== */
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { schedules, workflows } from "@erp-framework/db";
import { router, rbacProcedure } from "./trpc";
import { scheduleInput } from "./router-helpers";

export const schedulesRouter =
router({
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
});
