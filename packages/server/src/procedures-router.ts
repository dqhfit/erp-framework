/* ==========================================================
   procedures-router.ts — tRPC router cho native procedure.
   - list/get  : view, theo công ty
   - save      : upsert theo (companyId, name); validate JS parse được
   - delete    : xoá
   - setEnabled: bật/tắt runtime
   - invoke    : chạy procedure đã lưu với args, trả output
   - test      : chạy ad-hoc code (chưa lưu) để preview trong designer
   ========================================================== */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { procedures } from "@erp-framework/db";
import { router, rbacProcedure } from "./trpc";
import { makeInvokeProcedure } from "./procedure-runner";
import { makeCallTool } from "./mcp-client";
import { logActivity } from "./activity";

const NAME_RE = /^[a-z][a-z0-9_]*$/;

const procInput = z.object({
  name: z.string().regex(NAME_RE, "name phải snake_case bắt đầu bằng chữ"),
  label: z.string().min(1),
  description: z.string().optional(),
  paramsSchema: z.array(z.record(z.unknown())).optional(),
  returnSchema: z.record(z.unknown()).optional(),
  code: z.string().min(1),
  enabled: z.boolean().optional(),
});

export const proceduresRouter = router({
  list: rbacProcedure("view", "procedure")
    .query(({ ctx }) => ctx.db.select().from(procedures)
      .where(eq(procedures.companyId, ctx.user.companyId))
      .orderBy(desc(procedures.updatedAt))),

  get: rbacProcedure("view", "procedure")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db.select().from(procedures)
        .where(and(eq(procedures.id, input),
          eq(procedures.companyId, ctx.user.companyId)));
      return row ?? null;
    }),

  save: rbacProcedure("edit", "procedure")
    .input(procInput)
    .mutation(async ({ ctx, input }) => {
      // Validate parse được (chỉ check syntax, không exec).
      try { new Function(input.code); }
      catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST",
          message: `Code lỗi syntax: ${(e as Error).message}` });
      }
      const values = {
        label: input.label,
        description: input.description ?? null,
        paramsSchema: input.paramsSchema ?? [],
        returnSchema: input.returnSchema ?? null,
        code: input.code,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        updatedAt: new Date(),
      };
      const [ex] = await ctx.db.select({ id: procedures.id })
        .from(procedures)
        .where(and(eq(procedures.companyId, ctx.user.companyId),
          eq(procedures.name, input.name)));
      if (ex) {
        const [row] = await ctx.db.update(procedures)
          .set(values).where(eq(procedures.id, ex.id)).returning();
        return row;
      }
      const [row] = await ctx.db.insert(procedures).values({
        companyId: ctx.user.companyId,
        name: input.name,
        createdBy: ctx.user.id,
        ...values,
      }).returning();
      return row;
    }),

  setEnabled: rbacProcedure("edit", "procedure")
    .input(z.object({ id: z.string().uuid(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(procedures)
        .set({ enabled: input.enabled, updatedAt: new Date() })
        .where(and(eq(procedures.id, input.id),
          eq(procedures.companyId, ctx.user.companyId)));
      return { ok: true };
    }),

  delete: rbacProcedure("edit", "procedure")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(procedures).where(and(
        eq(procedures.id, input),
        eq(procedures.companyId, ctx.user.companyId)));
    }),

  invoke: rbacProcedure("run", "procedure")
    .input(z.object({
      name: z.string(),
      args: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const invoke = makeInvokeProcedure({
        db: ctx.db,
        companyId: ctx.user.companyId,
        callTool: makeCallTool(ctx.db, ctx.user.companyId),
        actorUserId: ctx.user.id,
      });
      try {
        const r = await invoke(input.name, input.args ?? {});
        await logActivity(ctx.db, {
          companyId: ctx.user.companyId,
          kind: "run_procedure",
          objectType: "procedure",
          target: input.name,
          detail: `Procedure chạy ${r.durationMs}ms`,
          actorUserId: ctx.user.id,
        });
        return r;
      } catch (e) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR",
          message: (e as Error).message });
      }
    }),

  // Chạy thử code chưa lưu — designer-only. Vẫn yêu cầu edit role.
  test: rbacProcedure("edit", "procedure")
    .input(z.object({
      code: z.string().min(1),
      args: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Tận dụng invoke bằng cách insert tạm? Đơn giản hơn: import
      // hàm runCode chưa export — tạm thời chạy bằng cách lưu 1 row
      // disabled với tên prefix `__test_<uuid>` rồi xoá. Tránh ô nhiễm
      // DB: dùng transaction rollback.
      const tempName = `__test_${Math.random().toString(36).slice(2, 10)}`;
      const [row] = await ctx.db.insert(procedures).values({
        companyId: ctx.user.companyId,
        name: tempName,
        label: "Test",
        code: input.code,
        enabled: true,
        createdBy: ctx.user.id,
      }).returning();
      try {
        const invoke = makeInvokeProcedure({
          db: ctx.db,
          companyId: ctx.user.companyId,
          callTool: makeCallTool(ctx.db, ctx.user.companyId),
          actorUserId: ctx.user.id,
        });
        const r = await invoke(tempName, input.args ?? {});
        return r;
      } catch (e) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR",
          message: (e as Error).message });
      } finally {
        if (row) {
          await ctx.db.delete(procedures).where(eq(procedures.id, row.id));
        }
      }
    }),
});
