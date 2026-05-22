/* ==========================================================
   entity-sync-router.ts — tRPC router cấu hình đồng bộ MCP →
   entity_records. Mỗi entity tối đa 1 cấu hình (khoá theo
   entityId). Scheduler quét cronExpr; runNow chạy tức thì.
   - list   : các cấu hình sync của công ty
   - get    : cấu hình sync của một entity (null nếu chưa có)
   - save   : tạo / cập nhật (upsert theo entityId)
   - delete : xoá cấu hình
   - runNow : chạy đồng bộ ngay, trả { status, created, updated… }
   Tất cả lọc theo công ty đang chọn (đa công ty).
   ========================================================== */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { entitySyncs, entities } from "@erp-framework/db";
import { router, rbacProcedure } from "./trpc";
import { runEntitySync } from "./run-entity-sync";

const syncInput = z.object({
  entityId: z.string().uuid(),
  cronExpr: z.string().min(1),
  enabled: z.boolean().optional(),
  pkField: z.string().optional(),
});

export const entitySyncRouter = router({
  list: rbacProcedure("view", "entity")
    .query(({ ctx }) => ctx.db.select().from(entitySyncs)
      .where(eq(entitySyncs.companyId, ctx.user.companyId))
      .orderBy(desc(entitySyncs.createdAt))),

  get: rbacProcedure("view", "entity")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db.select().from(entitySyncs)
        .where(and(eq(entitySyncs.entityId, input),
          eq(entitySyncs.companyId, ctx.user.companyId)));
      return row ?? null;
    }),

  save: rbacProcedure("edit", "entity")
    .input(syncInput)
    .mutation(async ({ ctx, input }) => {
      // Entity phải thuộc công ty đang chọn.
      const [ent] = await ctx.db.select({ id: entities.id }).from(entities)
        .where(and(eq(entities.id, input.entityId),
          eq(entities.companyId, ctx.user.companyId)));
      if (!ent) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Entity không tồn tại" });
      }
      const values = {
        cronExpr: input.cronExpr,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.pkField !== undefined ? { pkField: input.pkField } : {}),
        updatedAt: new Date(),
      };
      // Upsert theo entityId — mỗi entity tối đa 1 cấu hình.
      const [existing] = await ctx.db.select({ id: entitySyncs.id })
        .from(entitySyncs).where(and(
          eq(entitySyncs.entityId, input.entityId),
          eq(entitySyncs.companyId, ctx.user.companyId)));
      if (existing) {
        const [row] = await ctx.db.update(entitySyncs).set(values)
          .where(eq(entitySyncs.id, existing.id)).returning();
        return row;
      }
      const [row] = await ctx.db.insert(entitySyncs).values({
        companyId: ctx.user.companyId,
        entityId: input.entityId,
        ...values,
      }).returning();
      return row;
    }),

  delete: rbacProcedure("delete", "entity")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(entitySyncs).where(and(
        eq(entitySyncs.id, input),
        eq(entitySyncs.companyId, ctx.user.companyId)));
    }),

  // Chạy đồng bộ ngay — đồng bộ, trả kết quả về client.
  runNow: rbacProcedure("edit", "entity")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      const [sy] = await ctx.db.select({ id: entitySyncs.id })
        .from(entitySyncs).where(and(
          eq(entitySyncs.id, input),
          eq(entitySyncs.companyId, ctx.user.companyId)));
      if (!sy) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cấu hình sync không tồn tại" });
      }
      return runEntitySync(ctx.db, input);
    }),
});
