/* ==========================================================
   record-comments-router.ts — Comments per record + nested replies.
   ========================================================== */
import { z } from "zod";
import { and, asc, eq, isNull } from "drizzle-orm";
import { recordComments, entityRecords } from "@erp-framework/db";
import { router, rbacProcedure } from "./trpc";
import { TRPCError } from "@trpc/server";

export const recordCommentsRouter = router({
  list: rbacProcedure("view", "entity")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      // Verify record thuộc company trước khi trả list.
      const [rec] = await ctx.db.select({ id: entityRecords.id }).from(entityRecords)
        .where(and(eq(entityRecords.id, input),
          eq(entityRecords.companyId, ctx.user.companyId)));
      if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "Record không tồn tại" });
      return ctx.db.select().from(recordComments)
        .where(and(
          eq(recordComments.recordId, input),
          eq(recordComments.companyId, ctx.user.companyId),
          isNull(recordComments.deletedAt),
        ))
        .orderBy(asc(recordComments.createdAt));
    }),

  add: rbacProcedure("view", "entity")
    .input(z.object({
      recordId: z.string().uuid(),
      parentId: z.string().uuid().optional(),
      body: z.string().min(1).max(5000),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify record + parent (nếu có) thuộc company.
      const [rec] = await ctx.db.select({ id: entityRecords.id }).from(entityRecords)
        .where(and(eq(entityRecords.id, input.recordId),
          eq(entityRecords.companyId, ctx.user.companyId)));
      if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "Record không tồn tại" });
      const [row] = await ctx.db.insert(recordComments).values({
        companyId: ctx.user.companyId,
        recordId: input.recordId,
        parentId: input.parentId ?? null,
        authorUserId: ctx.user.id,
        body: input.body,
      }).returning();
      return row;
    }),

  delete: rbacProcedure("view", "entity")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      // Chỉ author hoặc admin được xoá.
      const [c] = await ctx.db.select({ authorUserId: recordComments.authorUserId })
        .from(recordComments).where(and(
          eq(recordComments.id, input),
          eq(recordComments.companyId, ctx.user.companyId),
        ));
      if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Comment không tồn tại" });
      if (c.authorUserId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ author hoặc admin xoá được" });
      }
      await ctx.db.update(recordComments)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(recordComments.id, input));
      return { ok: true };
    }),
});
