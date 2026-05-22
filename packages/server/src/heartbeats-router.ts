/* ==========================================================
   heartbeats-router.ts — tRPC router cấu hình heartbeat:
   agent tự thức dậy theo lịch cron và hành động một nhịp.
   - list    : heartbeat của công ty (lọc theo agent nếu cần)
   - save    : tạo / cập nhật một heartbeat
   - delete  : xoá heartbeat
   - runNow  : chạy thử ngay một nhịp (không chờ lịch)
   Tất cả lọc theo công ty đang chọn (đa công ty).
   ========================================================== */
import { z } from "zod";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { agentHeartbeats, agents } from "@erp-framework/db";
import { router, rbacProcedure } from "./trpc";
import { runHeartbeat } from "./run-heartbeat";

const heartbeatInput = z.object({
  id: z.string().uuid().optional(),
  agentId: z.string().uuid(),
  cronExpr: z.string().min(1),
  enabled: z.boolean().optional(),
  prompt: z.string().min(1),
});

export const heartbeatsRouter = router({
  list: rbacProcedure("view", "agent")
    .input(z.object({ agentId: z.string().uuid().optional() }).optional())
    .query(({ ctx, input }) => {
      const conds: SQL[] = [eq(agentHeartbeats.companyId, ctx.user.companyId)];
      if (input?.agentId) conds.push(eq(agentHeartbeats.agentId, input.agentId));
      return ctx.db.select().from(agentHeartbeats)
        .where(and(...conds))
        .orderBy(desc(agentHeartbeats.createdAt));
    }),

  save: rbacProcedure("edit", "agent")
    .input(heartbeatInput)
    .mutation(async ({ ctx, input }) => {
      // Agent của heartbeat phải thuộc công ty đang chọn.
      const [ag] = await ctx.db.select({ id: agents.id }).from(agents)
        .where(and(eq(agents.id, input.agentId),
          eq(agents.companyId, ctx.user.companyId)));
      if (!ag) throw new TRPCError({ code: "NOT_FOUND", message: "Agent không tồn tại" });
      const values = {
        agentId: input.agentId,
        cronExpr: input.cronExpr,
        prompt: input.prompt,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      };
      if (input.id) {
        const [ex] = await ctx.db
          .select({ companyId: agentHeartbeats.companyId })
          .from(agentHeartbeats).where(eq(agentHeartbeats.id, input.id));
        if (ex && ex.companyId !== ctx.user.companyId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Heartbeat thuộc công ty khác" });
        }
        if (ex) {
          const [row] = await ctx.db.update(agentHeartbeats).set(values)
            .where(eq(agentHeartbeats.id, input.id)).returning();
          return row;
        }
        const [row] = await ctx.db.insert(agentHeartbeats)
          .values({ id: input.id, companyId: ctx.user.companyId, ...values })
          .returning();
        return row;
      }
      const [row] = await ctx.db.insert(agentHeartbeats)
        .values({ companyId: ctx.user.companyId, ...values }).returning();
      return row;
    }),

  delete: rbacProcedure("delete", "agent")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(agentHeartbeats).where(and(
        eq(agentHeartbeats.id, input),
        eq(agentHeartbeats.companyId, ctx.user.companyId)));
    }),

  // Chạy thử ngay một nhịp — đồng bộ, trả kết quả về client.
  runNow: rbacProcedure("run", "agent")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      const [hb] = await ctx.db.select({ id: agentHeartbeats.id })
        .from(agentHeartbeats).where(and(
          eq(agentHeartbeats.id, input),
          eq(agentHeartbeats.companyId, ctx.user.companyId)));
      if (!hb) throw new TRPCError({ code: "NOT_FOUND", message: "Heartbeat không tồn tại" });
      return runHeartbeat(ctx.db, input);
    }),
});
