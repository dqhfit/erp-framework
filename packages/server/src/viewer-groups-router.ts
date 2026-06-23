/* ==========================================================
   viewer-groups-router.ts -- CRUD nhom nguoi xem (viewer groups).
   Admin/Editor quan ly nhom, gan user va trang vao nhom.
   Viewer chi thay trang co nhom khop hoac khong han che nhom.
   ========================================================== */
import {
  companyMembers,
  pages,
  pageViewerGroups,
  userPageAccess,
  userViewerGroups,
  viewerGroups,
} from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
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
      // Nhóm PHẢI thuộc công ty đang chọn (chống editor tenant A ghi đè nhóm tenant B).
      const [grp] = await ctx.db
        .select({ id: viewerGroups.id })
        .from(viewerGroups)
        .where(
          and(eq(viewerGroups.id, input.groupId), eq(viewerGroups.companyId, ctx.user.companyId)),
        );
      if (!grp) throw new TRPCError({ code: "NOT_FOUND", message: "Nhóm không tồn tại" });
      // Chỉ nhận user là thành viên công ty (chống thêm user ngoài tenant → lộ trang).
      const validUserIds = input.userIds.length
        ? (
            await ctx.db
              .select({ userId: companyMembers.userId })
              .from(companyMembers)
              .where(
                and(
                  eq(companyMembers.companyId, ctx.user.companyId),
                  inArray(companyMembers.userId, input.userIds),
                ),
              )
          ).map((m) => m.userId)
        : [];
      await ctx.db.delete(userViewerGroups).where(eq(userViewerGroups.groupId, input.groupId));
      if (validUserIds.length > 0) {
        await ctx.db
          .insert(userViewerGroups)
          .values(validUserIds.map((userId) => ({ userId, groupId: input.groupId })));
      }
    }),

  /** Thay the toan bo nhom duoc gan cho trang */
  setPageGroups: rbacProcedure("edit", "page")
    .input(z.object({ pageId: z.string().uuid(), groupIds: z.array(z.string().uuid()) }))
    .mutation(async ({ ctx, input }) => {
      // Trang PHẢI thuộc công ty (chống sửa cấu hình visibility trang tenant khác).
      const [pg] = await ctx.db
        .select({ id: pages.id })
        .from(pages)
        .where(and(eq(pages.id, input.pageId), eq(pages.companyId, ctx.user.companyId)));
      if (!pg) throw new TRPCError({ code: "NOT_FOUND", message: "Trang không tồn tại" });
      // Chỉ nhận nhóm thuộc công ty (chống gắn nhóm chéo tenant vào trang).
      const validGroupIds = input.groupIds.length
        ? (
            await ctx.db
              .select({ id: viewerGroups.id })
              .from(viewerGroups)
              .where(
                and(
                  eq(viewerGroups.companyId, ctx.user.companyId),
                  inArray(viewerGroups.id, input.groupIds),
                ),
              )
          ).map((g) => g.id)
        : [];
      await ctx.db.delete(pageViewerGroups).where(eq(pageViewerGroups.pageId, input.pageId));
      if (validGroupIds.length > 0) {
        await ctx.db
          .insert(pageViewerGroups)
          .values(validGroupIds.map((groupId) => ({ pageId: input.pageId, groupId })));
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

  /** Danh sach pageId ma nguoi dung hien tai duoc cap quyen ca nhan */
  getMyPageAccess: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.companyId) return [];
    const rows = await ctx.db
      .select({ pageId: userPageAccess.pageId })
      .from(userPageAccess)
      .where(
        and(
          eq(userPageAccess.userId, ctx.user.id),
          eq(userPageAccess.companyId, ctx.user.companyId),
        ),
      );
    return rows.map((r) => r.pageId);
  }),

  /** Liet ke tat ca quyen ca nhan theo cong ty (cho admin quan ly) */
  listUserPageAccess: rbacProcedure("edit", "page").query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        userId: userPageAccess.userId,
        pageId: userPageAccess.pageId,
        grantedBy: userPageAccess.grantedBy,
        createdAt: userPageAccess.createdAt,
      })
      .from(userPageAccess)
      .where(eq(userPageAccess.companyId, ctx.user.companyId));
    // Gom theo userId -> pageIds
    const map = new Map<string, string[]>();
    for (const r of rows) {
      const list = map.get(r.userId) ?? [];
      list.push(r.pageId);
      map.set(r.userId, list);
    }
    return Array.from(map.entries()).map(([userId, pageIds]) => ({ userId, pageIds }));
  }),

  /** Thay the toan bo quyen trang ca nhan cua 1 user trong cong ty */
  setUserPages: rbacProcedure("edit", "page")
    .input(z.object({ userId: z.string().uuid(), pageIds: z.array(z.string().uuid()) }))
    .mutation(async ({ ctx, input }) => {
      // Chi nhan user la thanh vien cong ty
      if (input.userId !== ctx.user.id) {
        const [member] = await ctx.db
          .select({ userId: companyMembers.userId })
          .from(companyMembers)
          .where(
            and(
              eq(companyMembers.companyId, ctx.user.companyId),
              eq(companyMembers.userId, input.userId),
            ),
          );
        if (!member)
          throw new TRPCError({ code: "NOT_FOUND", message: "Tài khoản không thuộc công ty" });
      }
      // Chi nhan page thuoc cong ty
      const validPageIds = input.pageIds.length
        ? (
            await ctx.db
              .select({ id: pages.id })
              .from(pages)
              .where(and(eq(pages.companyId, ctx.user.companyId), inArray(pages.id, input.pageIds)))
          ).map((p) => p.id)
        : [];
      await ctx.db
        .delete(userPageAccess)
        .where(
          and(
            eq(userPageAccess.userId, input.userId),
            eq(userPageAccess.companyId, ctx.user.companyId),
          ),
        );
      if (validPageIds.length > 0) {
        await ctx.db.insert(userPageAccess).values(
          validPageIds.map((pageId) => ({
            userId: input.userId,
            pageId,
            companyId: ctx.user.companyId,
            grantedBy: ctx.user.id,
          })),
        );
      }
      return { ok: true };
    }),
});
