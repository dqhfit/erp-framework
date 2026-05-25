/* ==========================================================
   pages-router.ts — CRUD page metadata (low-code designer).
   Tách khỏi router.ts (Sprint 1 P2.8 step 6).
   ========================================================== */
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { pages } from "@erp-framework/db";
import { router, rbacProcedure } from "./trpc";
import { pageInput } from "./router-helpers";

export const pagesRouter =
router({
    list: rbacProcedure("view", "page")
      .query(({ ctx }) => ctx.db.select().from(pages)
        .where(eq(pages.companyId, ctx.user.companyId))),

    get: rbacProcedure("view", "page")
      .input(z.string().uuid())
      .query(async ({ ctx, input }) => {
        const [row] = await ctx.db.select().from(pages)
          .where(and(eq(pages.id, input),
            eq(pages.companyId, ctx.user.companyId)));
        return row ?? null;
      }),

    // Upsert: id do client cấp → INSERT nếu chưa có, UPDATE nếu đã có
    // (chỉ trong phạm vi công ty — id của công ty khác bị từ chối).
    save: rbacProcedure("edit", "page")
      .input(pageInput)
      .mutation(async ({ ctx, input }) => {
        const values = {
          name: input.name, label: input.label, icon: input.icon ?? null,
          content: input.content ?? {},
        };
        if (input.id) {
          const [ex] = await ctx.db.select({ companyId: pages.companyId })
            .from(pages).where(eq(pages.id, input.id));
          if (ex && ex.companyId !== ctx.user.companyId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Đối tượng thuộc công ty khác" });
          }
          if (ex) {
            const [row] = await ctx.db.update(pages)
              .set({ ...values, updatedAt: new Date() })
              .where(eq(pages.id, input.id)).returning();
            return row;
          }
          const [row] = await ctx.db.insert(pages)
            .values({ id: input.id, companyId: ctx.user.companyId, ...values })
            .returning();
          return row;
        }
        const [row] = await ctx.db.insert(pages)
          .values({ companyId: ctx.user.companyId, ...values }).returning();
        return row;
      }),

    delete: rbacProcedure("delete", "page")
      .input(z.string().uuid())
      .mutation(async ({ ctx, input }) => {
        await ctx.db.delete(pages).where(and(eq(pages.id, input),
          eq(pages.companyId, ctx.user.companyId)));
      }),
});
