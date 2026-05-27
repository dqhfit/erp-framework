/* ==========================================================
   viewer-groups-router.ts -- CRUD nhom nguoi xem (viewer groups).
   Admin/Editor quan ly nhom, gan user va trang vao nhom.
   Viewer chi thay trang co nhom khop hoac khong han che nhom.
   ========================================================== */
import { pageViewerGroups, userViewerGroups, viewerGroups } from "@erp-framework/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { approvedProcedure, protectedProcedure, rbacProcedure, router } from "./trpc";

export const viewerGroupsRouter = router({
  /** Liet ke tat ca nhom trong cong ty kem memberIds + pageIds */
  list: approvedProcedure.query(async ({ ctx }) => {
    const groups = await ctx.db
      .select()
      .from(viewerGroups)
      .where(eq(viewerGroups.companyId, ctx.user.companyId));
    const members = await ctx.db
      .select({ groupId: userViewerGroups.groupId, userId: userViewerGroups.userId })
      .from(userViewerGroups)
      .innerJoin(viewerGroups, eq(userViewerGroups.groupId, viewerGroups.id))
      .where(eq(viewerGroups.companyId, ctx.user.companyId));
    const pgAssign = await ctx.db
      .select({ groupId: pageViewerGroups.groupId, pageId: pageViewerGroups.pageId })
      .from(pageViewerGroups)
      .innerJoin(viewerGroups, eq(pageViewerGroups.groupId, viewerGroups.id))
      .where(eq(viewerGroups.companyId, ctx.user.companyId));
    return groups.map((g) => ({
      ...g,
      memberIds: members.filter((m) => m.groupId === g.id).map((m) => m.userId),
      pageIds: pgAssign.filter((p) => p.groupId === g.id).map((p) => p.pageId),
    }));
  }),

  create: rbacProcedure("edit", "page")
    .input(z.object({ name: z.string().min(1), color: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(viewerGroups)
        .values({
          companyId: ctx.user.companyId,
          name: input.name,
          color: input.color ?? "#6366f1",
        })
        .returning();
      return row;
    }),

  rename: rbacProcedure("edit", "page")
    .input(
      z.object({ id: z.string().uuid(), name: z.string().min(1), color: z.string().optional() }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(viewerGroups)
        .set({ name: input.name, ...(input.color ? { color: input.color } : {}) })
        .where(and(eq(viewerGroups.id, input.id), eq(viewerGroups.companyId, ctx.user.companyId)));
    }),

  delete: rbacProcedure("delete", "page")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(viewerGroups)
        .where(and(eq(viewerGroups.id, input), eq(viewerGroups.companyId, ctx.user.companyId)));
    }),

  /** Thay the toan bo thanh vien cua nhom */
  setMembers: rbacProcedure("edit", "page")
    .input(z.object({ groupId: z.string().uuid(), userIds: z.array(z.string().uuid()) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(userViewerGroups).where(eq(userViewerGroups.groupId, input.groupId));
      if (input.userIds.length > 0) {
        await ctx.db
          .insert(userViewerGroups)
          .values(input.userIds.map((userId) => ({ userId, groupId: input.groupId })));
      }
    }),

  /** Thay the toan bo nhom duoc gan cho trang */
  setPageGroups: rbacProcedure("edit", "page")
    .input(z.object({ pageId: z.string().uuid(), groupIds: z.array(z.string().uuid()) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(pageViewerGroups).where(eq(pageViewerGroups.pageId, input.pageId));
      if (input.groupIds.length > 0) {
        await ctx.db
          .insert(pageViewerGroups)
          .values(input.groupIds.map((groupId) => ({ pageId: input.pageId, groupId })));
      }
    }),

  /** Nhom cua nguoi dung hien tai -- dung de loc trang trong portal/sidebar */
  getMyGroups: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ groupId: userViewerGroups.groupId })
      .from(userViewerGroups)
      .where(eq(userViewerGroups.userId, ctx.user.id));
    return rows.map((r) => r.groupId);
  }),
});
