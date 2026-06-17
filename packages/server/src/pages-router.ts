/* ==========================================================
   pages-router.ts — CRUD page metadata (low-code designer).
   Tách khỏi router.ts (Sprint 1 P2.8 step 6).
   ========================================================== */
import { navItems, pages, pageViewerGroups } from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { pageInput } from "./router-helpers";
import { publicProcedure, rbacProcedure, router } from "./trpc";

export const pagesRouter = router({
  // Chỉ trang ACTIVE (chưa xoá mềm).
  list: rbacProcedure("view", "page").query(async ({ ctx }) => {
    const [pagesList, groupAssignments] = await Promise.all([
      ctx.db
        .select()
        .from(pages)
        .where(and(eq(pages.companyId, ctx.user.companyId), isNull(pages.deletedAt))),
      ctx.db
        .select({ pageId: pageViewerGroups.pageId, groupId: pageViewerGroups.groupId })
        .from(pageViewerGroups)
        .innerJoin(pages, eq(pageViewerGroups.pageId, pages.id))
        .where(eq(pages.companyId, ctx.user.companyId)),
    ]);
    return pagesList.map((p) => ({
      ...p,
      viewerGroupIds: groupAssignments.filter((g) => g.pageId === p.id).map((g) => g.groupId),
    }));
  }),

  get: rbacProcedure("view", "page")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(pages)
        .where(
          and(
            eq(pages.id, input),
            eq(pages.companyId, ctx.user.companyId),
            isNull(pages.deletedAt),
          ),
        );
      return row ?? null;
    }),

  /** Danh sách trang trong THÙNG RÁC (đã xoá mềm) — cho UI khôi phục. */
  listTrash: rbacProcedure("view", "page").query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: pages.id,
        name: pages.name,
        label: pages.label,
        icon: pages.icon,
        deletedAt: pages.deletedAt,
        updatedAt: pages.updatedAt,
      })
      .from(pages)
      .where(and(eq(pages.companyId, ctx.user.companyId), isNotNull(pages.deletedAt)))
      .orderBy(desc(pages.deletedAt));
    return rows;
  }),

  /** Khôi phục 1 trang khỏi thùng rác (deleted_at = null). Lỗi nếu trùng tên
   *  với trang active (do unique partial) — caller báo user đổi tên/xoá trang kia. */
  restore: rbacProcedure("delete", "page")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      try {
        const [row] = await ctx.db
          .update(pages)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(and(eq(pages.id, input), eq(pages.companyId, ctx.user.companyId)))
          .returning({ id: pages.id });
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Trang không tồn tại." });
        return { ok: true };
      } catch (e) {
        if (e instanceof TRPCError) throw e;
        throw new TRPCError({
          code: "CONFLICT",
          message: "Khôi phục thất bại — có thể đã có trang active trùng tên (đổi tên trang kia).",
        });
      }
    }),

  /** Xoá VĨNH VIỄN 1 trang khỏi thùng rác (hard delete + dọn nav item). */
  purge: rbacProcedure("delete", "page")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(pages)
        .where(and(eq(pages.id, input), eq(pages.companyId, ctx.user.companyId)));
      await ctx.db
        .delete(navItems)
        .where(
          and(
            eq(navItems.companyId, ctx.user.companyId),
            eq(navItems.kind, "page"),
            eq(navItems.target, input),
          ),
        );
      return { ok: true };
    }),

  // Upsert: id do client cấp → INSERT nếu chưa có, UPDATE nếu đã có
  // (chỉ trong phạm vi công ty — id của công ty khác bị từ chối).
  save: rbacProcedure("edit", "page")
    .input(pageInput)
    .mutation(async ({ ctx, input }) => {
      const values = {
        name: input.name,
        label: input.label,
        icon: input.icon ?? null,
        content: (input.content ?? []) as unknown,
      };
      if (input.id) {
        const [ex] = await ctx.db
          .select({ companyId: pages.companyId })
          .from(pages)
          .where(eq(pages.id, input.id));
        if (ex && ex.companyId !== ctx.user.companyId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Đối tượng thuộc công ty khác" });
        }
        if (ex) {
          const [row] = await ctx.db
            .update(pages)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(pages.id, input.id))
            .returning();
          return row;
        }
        const [row] = await ctx.db
          .insert(pages)
          .values({ id: input.id, companyId: ctx.user.companyId, ...values })
          .returning();
        return row;
      }
      const [row] = await ctx.db
        .insert(pages)
        .values({ companyId: ctx.user.companyId, ...values })
        .returning();
      return row;
    }),

  // XOÁ MỀM: đánh dấu deleted_at → trang vào thùng rác (khôi phục được). KHÔNG
  // dọn link menu (legacy_menu_map.page_id) để restore còn trả lại đúng vị trí;
  // read path (navTree/pageBindings) tự bỏ qua trang đã xoá. Xoá hẳn = purge.
  delete: rbacProcedure("delete", "page")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(pages)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(pages.id, input), eq(pages.companyId, ctx.user.companyId)))
        .returning({ id: pages.id });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Trang không tồn tại." });
      return { ok: true };
    }),

  publish: rbacProcedure("publish", "page")
    .input(
      z.object({
        id: z.string().uuid(),
        mode: z.enum(["private", "public"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [ex] = await ctx.db
        .select({ companyId: pages.companyId })
        .from(pages)
        .where(eq(pages.id, input.id));
      if (!ex || ex.companyId !== ctx.user.companyId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trang không tồn tại" });
      }
      const [row] = await ctx.db
        .update(pages)
        .set({ published: true, publishMode: input.mode, updatedAt: new Date() })
        .where(eq(pages.id, input.id))
        .returning();
      return row;
    }),

  unpublish: rbacProcedure("publish", "page")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      const [ex] = await ctx.db
        .select({ companyId: pages.companyId })
        .from(pages)
        .where(eq(pages.id, input));
      if (!ex || ex.companyId !== ctx.user.companyId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trang không tồn tại" });
      }
      await ctx.db
        .update(pages)
        .set({ published: false, updatedAt: new Date() })
        .where(eq(pages.id, input));
    }),

  // Endpoint không cần auth — trả trang nếu published=true AND publish_mode='public'.
  // Dùng cho /view/:pageId khi đối tác chưa đăng nhập.
  getPublic: publicProcedure.input(z.string().uuid()).query(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select()
      .from(pages)
      // Chỉ trang published=true VÀ publishMode='public' mới lộ ra cho ẩn danh.
      // Trang 'private' (chỉ cho thành viên đăng nhập) KHÔNG trả ở endpoint này.
      .where(and(eq(pages.id, input), eq(pages.published, true), eq(pages.publishMode, "public")));
    if (!row) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Trang không tồn tại hoặc chưa được xuất bản công khai",
      });
    }
    return row;
  }),
});
