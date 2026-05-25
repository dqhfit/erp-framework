/* ==========================================================
   saved-views-router.ts — Per-user saved views per entity.
   View = { query: filter/sort/q/limit, columns?: string[], isDefault }
   Mở entity load view default; user switch view khác qua dropdown.
   ========================================================== */
import { z } from "zod";
import { and, desc, eq, or, isNull } from "drizzle-orm";
import { savedViews } from "@erp-framework/db";
import { router, rbacProcedure } from "./trpc";

const viewInput = z.object({
  entityId: z.string().uuid(),
  name: z.string().min(1).max(80),
  query: z.record(z.unknown()).optional(),
  columns: z.array(z.string()).optional(),
  isDefault: z.boolean().optional(),
});

export const savedViewsRouter = router({
  list: rbacProcedure("view", "entity")
    .input(z.string().uuid())
    .query(({ ctx, input }) =>
      ctx.db.select().from(savedViews)
        .where(and(
          eq(savedViews.companyId, ctx.user.companyId),
          eq(savedViews.entityId, input),
          // Của chính user hoặc shared (createdBy null = company-wide).
          or(
            eq(savedViews.createdBy, ctx.user.id),
            isNull(savedViews.createdBy),
          ),
        ))
        .orderBy(desc(savedViews.isDefault), desc(savedViews.updatedAt))),

  save: rbacProcedure("view", "entity")
    .input(viewInput.extend({ id: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const values = {
        name: input.name,
        query: input.query ?? {},
        columns: input.columns ?? null,
        isDefault: input.isDefault ?? false,
        updatedAt: new Date(),
      };
      if (input.id) {
        const [row] = await ctx.db.update(savedViews)
          .set(values).where(and(
            eq(savedViews.id, input.id),
            eq(savedViews.companyId, ctx.user.companyId),
            eq(savedViews.createdBy, ctx.user.id),
          )).returning();
        return row;
      }
      const [row] = await ctx.db.insert(savedViews).values({
        companyId: ctx.user.companyId,
        entityId: input.entityId,
        createdBy: ctx.user.id,
        ...values,
      }).returning();
      return row;
    }),

  setDefault: rbacProcedure("view", "entity")
    .input(z.object({ id: z.string().uuid(), entityId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Unset default cho mọi view khác của (user, entity) trước.
      await ctx.db.update(savedViews)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(
          eq(savedViews.companyId, ctx.user.companyId),
          eq(savedViews.entityId, input.entityId),
          eq(savedViews.createdBy, ctx.user.id),
        ));
      await ctx.db.update(savedViews)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(and(
          eq(savedViews.id, input.id),
          eq(savedViews.companyId, ctx.user.companyId),
          eq(savedViews.createdBy, ctx.user.id),
        ));
      return { ok: true };
    }),

  delete: rbacProcedure("view", "entity")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(savedViews).where(and(
        eq(savedViews.id, input),
        eq(savedViews.companyId, ctx.user.companyId),
        eq(savedViews.createdBy, ctx.user.id),
      ));
    }),
});
