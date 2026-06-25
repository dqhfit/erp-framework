/* ==========================================================
   pages-router.ts — CRUD page metadata (low-code designer).
   Tách khỏi router.ts (Sprint 1 P2.8 step 6).
   ========================================================== */
import { navItems, pageFlags, pages, pageViewerGroups } from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { pageInput } from "./router-helpers";
import { publicProcedure, rbacProcedure, router } from "./trpc";

// Token màu hợp lệ cho cờ tùy chỉnh (semantic, đổi theo theme — không hardcode hex).
// Nhãn/màu cờ built-in định nghĩa ở frontend src/lib/page-status.ts; server chỉ
// lưu key (built-in) hoặc id (uuid cờ tùy chỉnh) trong pages.status.
const FLAG_COLOR_TOKENS = [
  "accent",
  "accent-2",
  "success",
  "warning",
  "danger",
  "neutral",
] as const;

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
          // Trang mới tạo → tự gắn cờ "Mới tạo" (status='new').
          .values({ id: input.id, companyId: ctx.user.companyId, status: "new", ...values })
          .returning();
        return row;
      }
      const [row] = await ctx.db
        .insert(pages)
        .values({ companyId: ctx.user.companyId, status: "new", ...values })
        .returning();
      return row;
    }),

  // Gắn / đổi / gỡ cờ trạng thái cho 1 trang. status = key built-in,
  // id (uuid) cờ tùy chỉnh, hoặc null (gỡ cờ).
  setStatus: rbacProcedure("edit", "page")
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.string().max(64).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(pages)
        .set({ status: input.status, updatedAt: new Date() })
        .where(
          and(
            eq(pages.id, input.id),
            eq(pages.companyId, ctx.user.companyId),
            isNull(pages.deletedAt),
          ),
        )
        .returning({ id: pages.id, status: pages.status });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Trang không tồn tại." });
      return row;
    }),

  // ── Cờ TÙY CHỈNH (page_flags) — "cờ của tôi", per-company ───────────────
  flagList: rbacProcedure("view", "page").query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(pageFlags)
      .where(eq(pageFlags.companyId, ctx.user.companyId))
      .orderBy(asc(pageFlags.sortOrder), asc(pageFlags.createdAt));
  }),

  // Upsert 1 cờ tùy chỉnh (id rỗng = tạo mới).
  flagSave: rbacProcedure("edit", "page")
    .input(
      z.object({
        id: z.string().uuid().optional(),
        label: z.string().min(1).max(64),
        color: z.enum(FLAG_COLOR_TOKENS),
        icon: z.string().max(40).nullable().optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const values = {
        label: input.label,
        color: input.color,
        icon: input.icon ?? null,
        sortOrder: input.sortOrder ?? 0,
      };
      if (input.id) {
        const [ex] = await ctx.db
          .select({ companyId: pageFlags.companyId })
          .from(pageFlags)
          .where(eq(pageFlags.id, input.id));
        if (ex && ex.companyId !== ctx.user.companyId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Cờ thuộc công ty khác" });
        }
        if (ex) {
          const [row] = await ctx.db
            .update(pageFlags)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(pageFlags.id, input.id))
            .returning();
          return row;
        }
      }
      const [row] = await ctx.db
        .insert(pageFlags)
        .values({ companyId: ctx.user.companyId, ...values })
        .returning();
      return row;
    }),

  // Xoá 1 cờ tùy chỉnh + gỡ cờ đó khỏi mọi trang đang gắn (status = null).
  flagDelete: rbacProcedure("edit", "page")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(pageFlags)
        .where(and(eq(pageFlags.id, input), eq(pageFlags.companyId, ctx.user.companyId)));
      // Gỡ binding mồ côi: trang nào đang trỏ cờ vừa xoá → bỏ cờ.
      await ctx.db
        .update(pages)
        .set({ status: null })
        .where(and(eq(pages.companyId, ctx.user.companyId), eq(pages.status, input)));
      return { ok: true };
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

  getPublic: publicProcedure.input(z.string().uuid()).query(async ({ ctx, input }) => {
    console.log("[getPublic] input:", input);
    console.log(
      "[getPublic] ctx.user:",
      ctx.user ? { id: ctx.user.id, companyId: ctx.user.companyId } : null,
    );
    const [row] = await ctx.db
      .select()
      .from(pages)
      .where(and(eq(pages.id, input), eq(pages.published, true)));
    console.log(
      "[getPublic] row found:",
      row
        ? {
            id: row.id,
            companyId: row.companyId,
            published: row.published,
            publishMode: row.publishMode,
          }
        : null,
    );
    if (!row) {
      console.log("[getPublic] Error: Page not found or not published");
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Trang không tồn tại hoặc chưa được xuất bản",
      });
    }

    if (row.publishMode === "private") {
      // Nếu chưa đăng nhập -> chỉ trả về metadata để frontend hiện màn hình đăng nhập
      if (!ctx.user) {
        console.log("[getPublic] Anonymous request for private page, returning metadata only");
        return {
          id: row.id,
          name: row.name,
          label: row.label,
          published: row.published,
          publishMode: row.publishMode,
          content: { components: [] },
        };
      }
      // Nếu đã đăng nhập nhưng khác công ty -> trả lỗi 404 bảo mật tenant
      if (row.companyId !== ctx.user.companyId) {
        console.log(
          `[getPublic] Error: Company mismatch. Page company: ${row.companyId}, User company: ${ctx.user.companyId}`,
        );
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Trang không tồn tại hoặc chưa được xuất bản",
        });
      }
    }
    console.log("[getPublic] Returning full page data");
    return row;
  }),
});
