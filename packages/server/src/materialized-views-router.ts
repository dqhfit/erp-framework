/* ==========================================================
   materialized-views-router.ts — Pre-computed query cache cho
   dashboard/report. Admin viết SQL query (read-only), schedule
   cron để refresh. Render từ data JSONB nhanh hơn re-execute.
   ========================================================== */
import { entityMaterializedViews } from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, desc, sql as dsql, eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "./db";
import { rbacProcedure, router } from "./trpc";

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

/** P4.3 — Cross-tenant guard. Materialized view chạy raw SQL với
 *  service-role connection (full DB access), nên admin có thể vô tình
 *  hoặc cố ý query bảng không scope theo company. Yêu cầu SQL phải
 *  reference `company_id` ở đâu đó (WHERE clause hoặc JOIN). v1 dùng
 *  regex check, v2 sẽ dùng SQL AST parser (pgsql-parser).
 *
 *  Convention admin: dùng placeholder `:company_id` trong query —
 *  server tự substitute literal companyId của session caller trước
 *  khi execute. Refresh từ cron (system-trusted) cũng dùng companyId
 *  của owner view. */
export function assertCompanyScopedSQL(sql: string): void {
  // Bắt cả comment-stripped form để tránh admin "trick" bằng comment.
  const stripped = sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .toLowerCase();
  if (!/\bcompany_id\b/.test(stripped)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "SQL phải reference `company_id` (WHERE company_id = :company_id) " +
        "để chặn cross-tenant. Server tự substitute :company_id literal " +
        "trước khi execute.",
    });
  }
}

/** Substitute placeholder :company_id bằng literal UUID (đã quote).
 *  v1 đơn giản: replace text. Bảo vệ qua zod UUID validation trên companyId
 *  + escape single quote (defensive — UUID không có quote nhưng vẫn check). */
function substituteCompanyId(sql: string, companyId: string): string {
  const escaped = companyId.replace(/'/g, "''");
  return sql.replace(/:company_id\b/g, `'${escaped}'`);
}

const viewInput = z.object({
  name: z.string().regex(NAME_RE, "name phải snake_case"),
  label: z.string().min(1),
  sqlQuery: z
    .string()
    .min(1)
    .refine(
      isReadOnlyQuery,
      "Chỉ chấp nhận SELECT/WITH read-only — không INSERT/UPDATE/DELETE/DDL",
    ),
  scheduleCron: z.string().optional(),
  enabled: z.boolean().optional(),
});

/** Refresh 1 view — chạy query, lưu data + lastRefreshedAt. Lỗi → lastError.
 *  P4.3: substitute :company_id placeholder bằng view.companyId (owner)
 *  trước khi execute để cross-tenant guard hoạt động cả khi cron auto-run. */
export async function refreshMaterializedView(
  db: DB,
  viewId: string,
): Promise<{ ok: boolean; rowCount: number; error?: string }> {
  const [view] = await db
    .select()
    .from(entityMaterializedViews)
    .where(eq(entityMaterializedViews.id, viewId));
  if (!view) return { ok: false, rowCount: 0, error: "View không tồn tại" };
  try {
    // Defense-in-depth: re-assert scope mỗi refresh (admin có thể đã update
    // SQL sau khi save, vd đổi mới sang câu thiếu company_id).
    assertCompanyScopedSQL(view.sqlQuery);
    const finalSql = substituteCompanyId(view.sqlQuery, view.companyId);
    const rows = (await db.execute(dsql.raw(finalSql))) as unknown as unknown[];
    await db
      .update(entityMaterializedViews)
      .set({
        data: rows as unknown as Record<string, unknown>,
        rowCount: Array.isArray(rows) ? rows.length : 0,
        lastRefreshedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(entityMaterializedViews.id, viewId));
    return { ok: true, rowCount: Array.isArray(rows) ? rows.length : 0 };
  } catch (e) {
    await db
      .update(entityMaterializedViews)
      .set({
        lastError: (e as Error).message,
        lastRefreshedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(entityMaterializedViews.id, viewId));
    return { ok: false, rowCount: 0, error: (e as Error).message };
  }
}

export const materializedViewsRouter = router({
  list: rbacProcedure("view", "settings").query(({ ctx }) =>
    ctx.db
      .select()
      .from(entityMaterializedViews)
      .where(eq(entityMaterializedViews.companyId, ctx.user.companyId))
      .orderBy(desc(entityMaterializedViews.updatedAt)),
  ),

  get: rbacProcedure("view", "settings")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(entityMaterializedViews)
        .where(
          and(
            eq(entityMaterializedViews.id, input),
            eq(entityMaterializedViews.companyId, ctx.user.companyId),
          ),
        );
      return row ?? null;
    }),

  save: rbacProcedure("edit", "settings")
    .input(viewInput.extend({ id: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      // P4.3 — fail-closed nếu SQL không reference company_id.
      assertCompanyScopedSQL(input.sqlQuery);
      const values = {
        label: input.label,
        sqlQuery: input.sqlQuery,
        scheduleCron: input.scheduleCron ?? null,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        updatedAt: new Date(),
      };
      if (input.id) {
        const [row] = await ctx.db
          .update(entityMaterializedViews)
          .set(values)
          .where(
            and(
              eq(entityMaterializedViews.id, input.id),
              eq(entityMaterializedViews.companyId, ctx.user.companyId),
            ),
          )
          .returning();
        return row;
      }
      const [row] = await ctx.db
        .insert(entityMaterializedViews)
        .values({
          companyId: ctx.user.companyId,
          name: input.name,
          createdBy: ctx.user.id,
          ...values,
        })
        .returning();
      return row;
    }),

  delete: rbacProcedure("edit", "settings")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(entityMaterializedViews)
        .where(
          and(
            eq(entityMaterializedViews.id, input),
            eq(entityMaterializedViews.companyId, ctx.user.companyId),
          ),
        );
    }),

  refresh: rbacProcedure("edit", "settings")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      // Verify thuộc company trước khi refresh.
      const [v] = await ctx.db
        .select({ id: entityMaterializedViews.id })
        .from(entityMaterializedViews)
        .where(
          and(
            eq(entityMaterializedViews.id, input),
            eq(entityMaterializedViews.companyId, ctx.user.companyId),
          ),
        );
      if (!v) throw new TRPCError({ code: "NOT_FOUND", message: "View không tồn tại" });
      return refreshMaterializedView(ctx.db, input);
    }),
});
