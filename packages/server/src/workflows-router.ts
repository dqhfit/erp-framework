/* ==========================================================
   workflows-router.ts — Workflow CRUD + publish + replay + runs.
   Tách khỏi router.ts (Sprint 1 P2.8 step 4).
   ========================================================== */
import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { workflows, workflowVersions, workflowRuns } from "@erp-framework/db";
import { router, rbacProcedure } from "./trpc";
import { workflowInput } from "./router-helpers";
import { executeWorkflow, recentRuns } from "./run-workflow";
import { logActivity } from "./activity";

export const workflowsRouter =
router({
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
        context: z.record(z.string(), z.unknown()).optional(),
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
});
