/* nav-router.ts — Trinh dung menu (PA2): CRUD nav_items dang cay per-company.
   - list: moi user da duyet doc duoc (render Sidebar).
   - create/update/move/reorder/delete: chi admin (rbac edit settings).
   Cay dung tu danh sach phang phia client theo parentId + sortOrder. */
import { navItems } from "@erp-framework/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { approvedProcedure, rbacProcedure, router } from "./trpc";

const KIND = z.enum(["group", "page", "link"]);

export const navRouter = router({
  /** Danh sach phang toan bo nav item cua company (client dung parentId dung cay). */
  list: approvedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(navItems)
      .where(eq(navItems.companyId, ctx.user.companyId))
      .orderBy(asc(navItems.sortOrder));
    return rows.map((r) => ({
      id: r.id,
      parentId: r.parentId,
      kind: r.kind as z.infer<typeof KIND>,
      label: r.label,
      icon: r.icon,
      target: r.target,
      sortOrder: r.sortOrder,
    }));
  }),

  /** Them 1 item — mac dinh dat cuoi danh sach anh em (sortOrder = max+1). */
  create: rbacProcedure("edit", "settings")
    .input(
      z.object({
        parentId: z.string().uuid().nullable().default(null),
        kind: KIND,
        label: z.string().min(1).max(120),
        icon: z.string().max(60).optional(),
        target: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // group khong co target; page/link bat buoc target.
      if (input.kind !== "group" && !input.target?.trim()) {
        throw new Error(`Item kind=${input.kind} can target (pageId hoac route/url).`);
      }
      const siblings = await ctx.db
        .select({ sortOrder: navItems.sortOrder })
        .from(navItems)
        .where(
          and(
            eq(navItems.companyId, ctx.user.companyId),
            input.parentId ? eq(navItems.parentId, input.parentId) : isNull(navItems.parentId),
          ),
        );
      const maxOrder = siblings.reduce((m, s) => Math.max(m, s.sortOrder), -1);
      const [row] = await ctx.db
        .insert(navItems)
        .values({
          companyId: ctx.user.companyId,
          parentId: input.parentId,
          kind: input.kind,
          label: input.label,
          icon: input.icon ?? null,
          target: input.kind === "group" ? null : (input.target ?? null),
          sortOrder: maxOrder + 1,
        })
        .returning({ id: navItems.id });
      return { id: row?.id ?? "" };
    }),

  update: rbacProcedure("edit", "settings")
    .input(
      z.object({
        id: z.string().uuid(),
        label: z.string().min(1).max(120).optional(),
        icon: z.string().max(60).nullable().optional(),
        target: z.string().max(500).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (input.label !== undefined) set.label = input.label;
      if (input.icon !== undefined) set.icon = input.icon;
      if (input.target !== undefined) set.target = input.target;
      await ctx.db
        .update(navItems)
        .set(set)
        .where(and(eq(navItems.id, input.id), eq(navItems.companyId, ctx.user.companyId)));
      return { ok: true };
    }),

  /** Keo-tha: doi cha + thu tu cho 1 item. */
  move: rbacProcedure("edit", "settings")
    .input(
      z.object({
        id: z.string().uuid(),
        parentId: z.string().uuid().nullable(),
        sortOrder: z.number().int().min(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Chong vong: khong cho dat cha la chinh no.
      if (input.parentId === input.id) {
        throw new Error("Khong the dat cha la chinh no.");
      }
      await ctx.db
        .update(navItems)
        .set({ parentId: input.parentId, sortOrder: input.sortOrder, updatedAt: new Date() })
        .where(and(eq(navItems.id, input.id), eq(navItems.companyId, ctx.user.companyId)));
      return { ok: true };
    }),

  /** Sap xep lai thu tu trong 1 nhom theo danh sach id (drag-drop reorder). */
  reorder: rbacProcedure("edit", "settings")
    .input(z.object({ orderedIds: z.array(z.string().uuid()) }))
    .mutation(async ({ ctx, input }) => {
      let i = 0;
      for (const id of input.orderedIds) {
        await ctx.db
          .update(navItems)
          .set({ sortOrder: i, updatedAt: new Date() })
          .where(and(eq(navItems.id, id), eq(navItems.companyId, ctx.user.companyId)));
        i++;
      }
      return { ok: true, count: input.orderedIds.length };
    }),

  /** Xoa 1 item (con se cascade theo FK). */
  delete: rbacProcedure("edit", "settings")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(navItems)
        .where(and(eq(navItems.id, input.id), eq(navItems.companyId, ctx.user.companyId)));
      return { ok: true };
    }),
});
