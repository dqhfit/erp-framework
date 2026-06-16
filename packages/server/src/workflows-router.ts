/* ==========================================================
   workflows-router.ts — Workflow CRUD + publish + replay + runs.
   Tách khỏi router.ts (Sprint 1 P2.8 step 4).
   ========================================================== */

import { workflowGuardrails, workflowRuns, workflows, workflowVersions } from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { logActivity } from "./activity";
import { workflowInput } from "./router-helpers";
import {
  assertGraphRoleRequirements,
  executeWorkflow,
  recentRuns,
  resumeWorkflowRun,
} from "./run-workflow";
import { approvedProcedure, rbacProcedure, router } from "./trpc";
import { WORKFLOW_TEMPLATES } from "./workflow-templates";

/** Chặn lưu/publish graph có node requiresRole cao hơn role người thao tác —
 *  ném FORBIDDEN thân thiện thay vì Error thô. */
function assertGraphRoleOrForbid(
  graph: unknown,
  actorRole: Parameters<typeof assertGraphRoleRequirements>[1],
): void {
  try {
    assertGraphRoleRequirements(graph, actorRole);
  } catch (e) {
    throw new TRPCError({ code: "FORBIDDEN", message: (e as Error).message });
  }
}

export const workflowsRouter = router({
  list: rbacProcedure("view", "workflow").query(({ ctx }) =>
    ctx.db.select().from(workflows).where(eq(workflows.companyId, ctx.user.companyId)),
  ),

  get: rbacProcedure("view", "workflow")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(workflows)
        .where(and(eq(workflows.id, input), eq(workflows.companyId, ctx.user.companyId)));
      return row ?? null;
    }),

  /* ── Template gallery: thư viện workflow dựng sẵn (Loops!-style) ── */
  // Danh sách template TĨNH — chỉ cần đăng nhập (như agents.listTemplates).
  listTemplates: approvedProcedure.query(() => WORKFLOW_TEMPLATES),

  // Clone template → workflow mới của công ty (deep-copy graph, lưu nguồn gốc).
  instantiateTemplate: rbacProcedure("create", "workflow")
    .input(z.object({ templateId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tpl = WORKFLOW_TEMPLATES.find((t) => t.id === input.templateId);
      if (!tpl) throw new TRPCError({ code: "NOT_FOUND", message: "Template không tồn tại" });
      const [row] = await ctx.db
        .insert(workflows)
        .values({
          companyId: ctx.user.companyId,
          name: tpl.name,
          triggerType: tpl.triggerType,
          graph: structuredClone(tpl.graph),
          sourceTemplateId: tpl.id,
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Insert thất bại" });
      await logActivity(ctx.db, {
        companyId: ctx.user.companyId,
        kind: "workflow.created",
        objectType: "workflow",
        target: tpl.name,
        detail: `Tạo workflow từ template "${tpl.id}"`,
        actorUserId: ctx.user.id,
      });
      return row;
    }),

  // Cập nhật workflow hiện có theo template mới nhất: ghi đè graph (NHÁP) +
  // triggerType, set sourceTemplateId. KHÔNG đụng publishedGraph (cần publish
  // lại để runner dùng) → tránh đổi hành vi runtime ngoài ý muốn.
  applyTemplate: rbacProcedure("edit", "workflow")
    .input(z.object({ workflowId: z.string().uuid(), templateId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tpl = WORKFLOW_TEMPLATES.find((t) => t.id === input.templateId);
      if (!tpl) throw new TRPCError({ code: "NOT_FOUND", message: "Template không tồn tại" });
      const [ex] = await ctx.db
        .select({ companyId: workflows.companyId })
        .from(workflows)
        .where(eq(workflows.id, input.workflowId));
      if (!ex || ex.companyId !== ctx.user.companyId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Workflow không tồn tại" });
      }
      const [row] = await ctx.db
        .update(workflows)
        .set({
          graph: structuredClone(tpl.graph),
          triggerType: tpl.triggerType,
          sourceTemplateId: tpl.id,
          updatedAt: new Date(),
        })
        .where(eq(workflows.id, input.workflowId))
        .returning();
      return row;
    }),

  save: rbacProcedure("edit", "workflow")
    .input(workflowInput)
    .mutation(async ({ ctx, input }) => {
      // Chống leo thang qua trigger: không cho người role thấp LƯU graph chứa
      // node requiresRole cao hơn họ (trigger run sau đó bỏ qua gate run-time).
      if (input.graph !== undefined) {
        assertGraphRoleOrForbid(input.graph, ctx.user.role);
      }
      const values = {
        name: input.name,
        triggerType: input.triggerType ?? "manual",
        ...(input.triggerConfig !== undefined ? { triggerConfig: input.triggerConfig } : {}),
        ...(input.graph !== undefined ? { graph: input.graph } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      };
      if (input.id) {
        // SELECT → INSERT-or-UPDATE (cùng pattern pages/agents):
        // client dùng crypto.randomUUID() làm id trước khi server biết → INSERT lần đầu,
        // UPDATE các lần sau. Cross-tenant: id công ty khác → FORBIDDEN.
        const [ex] = await ctx.db
          .select({ companyId: workflows.companyId })
          .from(workflows)
          .where(eq(workflows.id, input.id));
        if (ex && ex.companyId !== ctx.user.companyId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Đối tượng thuộc công ty khác" });
        }
        if (ex) {
          const [row] = await ctx.db
            .update(workflows)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(workflows.id, input.id))
            .returning();
          if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Workflow không tồn tại" });
          return row;
        }
        const [row] = await ctx.db
          .insert(workflows)
          .values({ id: input.id, companyId: ctx.user.companyId, ...values })
          .returning();
        return row;
      }
      const [row] = await ctx.db
        .insert(workflows)
        .values({ companyId: ctx.user.companyId, ...values })
        .returning();
      return row;
    }),

  delete: rbacProcedure("delete", "workflow")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(workflows)
        .where(and(eq(workflows.id, input), eq(workflows.companyId, ctx.user.companyId)));
    }),

  // Publish: chốt bản nháp graph hiện tại → publishedGraph (runner chạy bản này).
  // V6: snapshot vào workflow_versions với weight 100; A/B test bằng cách
  // publish thêm version với label khác + chỉnh weight.
  publish: rbacProcedure("edit", "workflow")
    .input(
      z
        .object({
          id: z.string().uuid(),
          label: z.string().optional(),
          weight: z.number().int().min(0).max(100).optional(),
        })
        .or(
          z
            .string()
            .uuid()
            .transform((id) => ({ id, label: undefined, weight: undefined })),
        ),
    )
    .mutation(async ({ ctx, input }) => {
      const [wf] = await ctx.db
        .select({ name: workflows.name, graph: workflows.graph })
        .from(workflows)
        .where(and(eq(workflows.id, input.id), eq(workflows.companyId, ctx.user.companyId)));
      if (!wf) throw new TRPCError({ code: "NOT_FOUND", message: "Workflow không tồn tại" });
      // Publish = chốt graph cho runner (trigger chạy bản này, không gate run-time)
      // → người publish phải đủ role cho mọi node requiresRole.
      assertGraphRoleOrForbid(wf.graph, ctx.user.role);
      await ctx.db
        .update(workflows)
        .set({ publishedGraph: wf.graph, updatedAt: new Date() })
        .where(eq(workflows.id, input.id));
      // Snapshot vào workflow_versions — nextVersion = max + 1.
      const [last] = await ctx.db
        .select({ version: workflowVersions.version })
        .from(workflowVersions)
        .where(eq(workflowVersions.workflowId, input.id))
        .orderBy(desc(workflowVersions.version))
        .limit(1);
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
      ctx.db
        .select()
        .from(workflowVersions)
        .where(
          and(
            eq(workflowVersions.workflowId, input),
            eq(workflowVersions.companyId, ctx.user.companyId),
          ),
        )
        .orderBy(desc(workflowVersions.version)),
    ),

  setVersionWeight: rbacProcedure("edit", "workflow")
    .input(
      z.object({
        versionId: z.string().uuid(),
        weight: z.number().int().min(0).max(100),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(workflowVersions)
        .set({
          weight: input.weight,
          ...(input.active !== undefined ? { active: input.active } : {}),
        })
        .where(
          and(
            eq(workflowVersions.id, input.versionId),
            eq(workflowVersions.companyId, ctx.user.companyId),
          ),
        );
      return { ok: true };
    }),

  /* Replay từ step k — chạy lại workflow dùng vars snapshot tại step k.
       Dùng cho debug "tại sao step này fail" — lặp nhanh fix node bug. */
  replay: rbacProcedure("run", "workflow")
    .input(
      z.object({
        runId: z.string().uuid(),
        fromStep: z.number().int().nonnegative().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [run] = await ctx.db
        .select()
        .from(workflowRuns)
        .where(
          and(eq(workflowRuns.id, input.runId), eq(workflowRuns.companyId, ctx.user.companyId)),
        );
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Run không tồn tại" });
      // Lấy vars snapshot trước step fromStep (hoặc initialVars nếu 0).
      // (run.steps có thể dùng v2 để rebuild vars precise per step.)
      const idx = input.fromStep ?? 0;
      const replayVars: Record<string, unknown> = {
        ...((run.vars as Record<string, unknown>) ?? {}),
      };
      // (Reconstruct vars trước step idx bằng output các step trước —
      // approx vì server không lưu snapshot từng step; v1 dùng vars cuối.)
      const r = await executeWorkflow(ctx.db, run.workflowId, {
        context: replayVars,
        companyId: ctx.user.companyId,
        actorRole: ctx.user.role,
        actorUserId: ctx.user.id,
      });
      return { runId: r.runId, status: r.status, stepCount: r.stepCount, replayedFrom: idx };
    }),

  /* Tiếp tục run đang chờ duyệt (node approval): đặt quyết định cho node rồi
     chạy tiếp từ checkpoint — node đã chạy KHÔNG lặp lại (chống side-effect
     trùng). decision "approved"/"rejected" → runner đi nhánh tương ứng. */
  resumeApproval: rbacProcedure("run", "workflow")
    .input(
      z.object({
        runId: z.string().uuid(),
        nodeId: z.string().min(1),
        decision: z.enum(["approved", "rejected"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const r = await resumeWorkflowRun(ctx.db, input.runId, {
        companyId: ctx.user.companyId,
        actorRole: ctx.user.role,
        actorUserId: ctx.user.id,
        decisions: { [`approval_${input.nodeId}`]: input.decision },
      });
      return { runId: r.runId, status: r.status, stepCount: r.stepCount };
    }),

  // Chạy workflow ngay (đồng bộ). pg-boss để chạy nền/cron là bước kế.
  trigger: rbacProcedure("run", "workflow")
    .input(
      z.object({
        workflowId: z.string().uuid(),
        context: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const r = await executeWorkflow(ctx.db, input.workflowId, {
        context: input.context,
        companyId: ctx.user.companyId,
        actorRole: ctx.user.role,
        actorUserId: ctx.user.id,
      });
      return { runId: r.runId, status: r.status };
    }),

  // Lịch sử các lần chạy gần đây của một workflow.
  runs: rbacProcedure("view", "workflow")
    .input(z.string().uuid())
    .query(({ ctx, input }) => recentRuns(ctx.db, input, ctx.user.companyId)),

  /* ── Guardrails: bài học từ node fail lặp lại (Loops!-style) ──
     list/update/archive — mọi truy vấn scope companyId (chống đọc chéo). */
  guardrails: router({
    list: rbacProcedure("view", "workflow")
      .input(z.string().uuid())
      .query(({ ctx, input }) =>
        ctx.db
          .select()
          .from(workflowGuardrails)
          .where(
            and(
              eq(workflowGuardrails.workflowId, input),
              eq(workflowGuardrails.companyId, ctx.user.companyId),
            ),
          )
          .orderBy(desc(workflowGuardrails.failCount)),
      ),

    // Sửa/ghi bài học (lesson) — chèn vào prompt các lần chạy sau.
    update: rbacProcedure("edit", "workflow")
      .input(z.object({ id: z.string().uuid(), lesson: z.string().max(2000) }))
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .update(workflowGuardrails)
          .set({
            lesson: input.lesson,
            status: "active",
            updatedBy: ctx.user.id,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(workflowGuardrails.id, input.id),
              eq(workflowGuardrails.companyId, ctx.user.companyId),
            ),
          )
          .returning();
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Guardrail không tồn tại" });
        return row;
      }),

    // Lưu trữ (không chèn vào prompt nữa) — đã xử lý xong lỗi.
    archive: rbacProcedure("edit", "workflow")
      .input(z.string().uuid())
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .update(workflowGuardrails)
          .set({ status: "archived", updatedBy: ctx.user.id, updatedAt: new Date() })
          .where(
            and(
              eq(workflowGuardrails.id, input),
              eq(workflowGuardrails.companyId, ctx.user.companyId),
            ),
          );
        return { ok: true };
      }),
  }),
});
