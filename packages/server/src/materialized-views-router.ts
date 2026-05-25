/* ==========================================================
   materialized-views-router.ts — Pre-computed query cache cho
   dashboard/report. Admin viết SQL query (read-only), schedule
   cron để refresh. Render từ data JSONB nhanh hơn re-execute.
   ========================================================== */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { entityMaterializedViews } from "@erp-framework/db";
import { router, rbacProcedure } from "./trpc";
import type { DB } from "./db";

const NAME_RE = /^[a-z][a-z0-9_]*$/;

/** Guard: chặn DDL/DML — chỉ cho SELECT/WITH. */
function isReadOnlyQuery(sql: string): boolean {
  const trimmed = sql.trim().toLowerCase();
  if (!trimmed) return false;
  // Khối WITH ... SELECT cũng OK.
  if (trimmed.startsWith("select") || trimmed.startsWith("with ")) {
    // Chặn keyword nguy hiểm trong query body — best-effort, không
    // bulletproof. Production thực sự cần connection role read-only.
    const banned = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy)\b/i;
    return !banned.test(trimmed);
  }
  return false;
}

const viewInput = z.object({
  name: z.string().regex(NAME_RE, "name phải snake_case"),
  label: z.string().min(1),
  sqlQuery: z.string().min(1).refine(isReadOnlyQuery,
    "Chỉ chấp nhận SELECT/WITH read-only — không INSERT/UPDATE/DELETE/DDL"),
  scheduleCron: z.string().optional(),
  enabled: z.boolean().optional(),
});

/** Refresh 1 view — chạy query, lưu data + lastRefreshedAt. Lỗi → lastError. */
export async function refreshMaterializedView(
  db: DB, viewId: string,
): Promise<{ ok: boolean; rowCount: number; error?: string }> {
  const [view] = await db.select().from(entityMaterializedViews)
    .where(eq(entityMaterializedViews.id, viewId));
  if (!view) return { ok: false, rowCount: 0, error: "View không tồn tại" };
  try {
    // Execute SQL (Drizzle raw). Caller đã verify read-only ở save.
    // Inject company_id qua psql substitution không tự nhiên với drizzle;
    // user tự nhúng company_id literal trong query nếu cần filter.
    const rows = await db.execute(view.sqlQuery as never) as unknown as unknown[];
    await db.update(entityMaterializedViews).set({
      data: rows as unknown as Record<string, unknown>,
      rowCount: Array.isArray(rows) ? rows.length : 0,
      lastRefreshedAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    }).where(eq(entityMaterializedViews.id, viewId));
    return { ok: true, rowCount: Array.isArray(rows) ? rows.length : 0 };
  } catch (e) {
    await db.update(entityMaterializedViews).set({
      lastError: (e as Error).message,
      lastRefreshedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(entityMaterializedViews.id, viewId));
    return { ok: false, rowCount: 0, error: (e as Error).message };
  }
}

export const materializedViewsRouter = router({
  list: rbacProcedure("view", "settings")
    .query(({ ctx }) => ctx.db.select().from(entityMaterializedViews)
      .where(eq(entityMaterializedViews.companyId, ctx.user.companyId))
      .orderBy(desc(entityMaterializedViews.updatedAt))),

  get: rbacProcedure("view", "settings")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db.select().from(entityMaterializedViews)
        .where(and(eq(entityMaterializedViews.id, input),
          eq(entityMaterializedViews.companyId, ctx.user.companyId)));
      return row ?? null;
    }),

  save: rbacProcedure("edit", "settings")
    .input(viewInput.extend({ id: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const values = {
        label: input.label,
        sqlQuery: input.sqlQuery,
        scheduleCron: input.scheduleCron ?? null,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        updatedAt: new Date(),
      };
      if (input.id) {
        const [row] = await ctx.db.update(entityMaterializedViews)
          .set(values).where(and(
            eq(entityMaterializedViews.id, input.id),
            eq(entityMaterializedViews.companyId, ctx.user.companyId),
          )).returning();
        return row;
      }
      const [row] = await ctx.db.insert(entityMaterializedViews).values({
        companyId: ctx.user.companyId,
        name: input.name,
        createdBy: ctx.user.id,
        ...values,
      }).returning();
      return row;
    }),

  delete: rbacProcedure("edit", "settings")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(entityMaterializedViews).where(and(
        eq(entityMaterializedViews.id, input),
        eq(entityMaterializedViews.companyId, ctx.user.companyId),
      ));
    }),

  refresh: rbacProcedure("edit", "settings")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      // Verify thuộc company trước khi refresh.
      const [v] = await ctx.db.select({ id: entityMaterializedViews.id })
        .from(entityMaterializedViews).where(and(
          eq(entityMaterializedViews.id, input),
          eq(entityMaterializedViews.companyId, ctx.user.companyId),
        ));
      if (!v) throw new TRPCError({ code: "NOT_FOUND", message: "View không tồn tại" });
      return refreshMaterializedView(ctx.db, input);
    }),
});
