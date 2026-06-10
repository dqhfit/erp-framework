/* ==========================================================
   record-comments-router.ts — Comments per record + nested replies.
   ========================================================== */

import { recordComments } from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { notifyMentions } from "./notifications-router";
import { getRecordStore } from "./record-store";
import { rbacProcedure, router } from "./trpc";

export const recordCommentsRouter = router({
  list: rbacProcedure("view", "comment")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      // Verify record thuộc company trước khi trả list (qua store — HYBRID-aware).
      const rec = await getRecordStore(ctx.db).getById(ctx.user.companyId, input);
      if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "Record không tồn tại" });
      return ctx.db
        .select()
        .from(recordComments)
        .where(
          and(
            eq(recordComments.recordId, input),
            eq(recordComments.companyId, ctx.user.companyId),
            isNull(recordComments.deletedAt),
          ),
        )
        .orderBy(asc(recordComments.createdAt));
    }),

  add: rbacProcedure("create", "comment")
    .input(
      z.object({
        recordId: z.string().uuid(),
        parentId: z.string().uuid().optional(),
        body: z.string().min(1).max(5000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify record + parent (nếu có) thuộc company (qua store — HYBRID-aware).
      const rec = await getRecordStore(ctx.db).getById(ctx.user.companyId, input.recordId);
      if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "Record không tồn tại" });
      const [row] = await ctx.db
        .insert(recordComments)
        .values({
          companyId: ctx.user.companyId,
          recordId: input.recordId,
          parentId: input.parentId ?? null,
          authorUserId: ctx.user.id,
          body: input.body,
        })
        .returning();
      // Notify @mentions (best-effort, không await caller).
      void notifyMentions(ctx.db, {
        companyId: ctx.user.companyId,
        actorUserId: ctx.user.id,
        body: input.body,
        targetRecordId: input.recordId,
        kind: "mention",
      });
      return row;
    }),

  delete: rbacProcedure("delete", "comment")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      // Chỉ author hoặc admin được xoá.
      const [c] = await ctx.db
        .select({ authorUserId: recordComments.authorUserId })
        .from(recordComments)
        .where(and(eq(recordComments.id, input), eq(recordComments.companyId, ctx.user.companyId)));
      if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Comment không tồn tại" });
      if (c.authorUserId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ author hoặc admin xoá được" });
      }
      await ctx.db
        .update(recordComments)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(recordComments.id, input));
      return { ok: true };
    }),
});
