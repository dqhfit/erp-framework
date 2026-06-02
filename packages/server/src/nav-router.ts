/* nav-router.ts — Trinh dung menu (PA2): CRUD nav_items dang cay per-company.
   - list: moi user da duyet doc duoc (render Sidebar).
   - create/update/move/reorder/delete: chi admin (rbac edit settings).
   Cay dung tu danh sach phang phia client theo parentId + sortOrder. */
import { navItems, pages } from "@erp-framework/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "./db";
import { approvedProcedure, rbacProcedure, router } from "./trpc";

const KIND = z.enum(["group", "page", "link"]);

/** Verify target=pageId trỏ tới page CÓ THẬT trong company (chống link chết). */
async function assertPageExists(db: DB, companyId: string, pageId: string): Promise<void> {
  const [p] = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.id, pageId), eq(pages.companyId, companyId)))
    .limit(1);
  if (!p) throw new Error(`Trang (pageId=${pageId}) không tồn tại.`);
}

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
      if (input.kind === "page" && input.target) {
        await assertPageExists(ctx.db, ctx.user.companyId, input.target);
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
      // Đổi target sang page → verify page tồn tại (chống link chết).
      if (input.target) {
        const [it] = await ctx.db
          .select({ kind: navItems.kind })
          .from(navItems)
          .where(and(eq(navItems.id, input.id), eq(navItems.companyId, ctx.user.companyId)))
          .limit(1);
        if (it?.kind === "page") {
          await assertPageExists(ctx.db, ctx.user.companyId, input.target);
        }
      }
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
      // Chong VONG: khong cho dat cha la chinh no HOAC la hau due cua no
      // (neu khong render de quy se vo han -> vo Sidebar toan company).
      if (input.parentId === input.id) {
        throw new Error("Khong the dat cha la chinh no.");
      }
      if (input.parentId) {
        const all = await ctx.db
          .select({ id: navItems.id, parentId: navItems.parentId })
          .from(navItems)
          .where(eq(navItems.companyId, ctx.user.companyId));
        const parentMap = new Map(all.map((r) => [r.id, r.parentId]));
        // Di nguoc tu parentId len goc: neu gap input.id -> tao vong.
        let cur: string | null = input.parentId;
        let guard = 0;
        while (cur && guard++ < 10_000) {
          if (cur === input.id) {
            throw new Error("Khong the keo nhom vao chinh nhanh con cua no.");
          }
          cur = parentMap.get(cur) ?? null;
        }
        // parentId phai ton tai trong company.
        if (!parentMap.has(input.parentId)) {
          throw new Error("Nhom cha khong ton tai.");
        }
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
      if (input.orderedIds.length === 0) return { ok: true, count: 0 };
      // Assert tất cả id thuộc company + CÙNG 1 parent (reorder chỉ trong 1 nhóm)
      // → tránh client lỗi gán sortOrder xuyên nhóm.
      const rows = await ctx.db
        .select({ id: navItems.id, parentId: navItems.parentId })
        .from(navItems)
        .where(eq(navItems.companyId, ctx.user.companyId));
      const byId = new Map(rows.map((r) => [r.id, r.parentId]));
      const parents = new Set<string | null>();
      for (const id of input.orderedIds) {
        if (!byId.has(id)) throw new Error(`Item ${id} không thuộc company.`);
        parents.add(byId.get(id) ?? null);
      }
      if (parents.size > 1) {
        throw new Error("reorder: các item không cùng 1 nhóm.");
      }
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
