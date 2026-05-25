/* ==========================================================
   enums-router.ts — Reusable enum (option set) đa ngôn ngữ.
   Field type "enum"/"multi-enum" tham chiếu qua id; nhiều field
   chia chung một enum (vd order_status, priority, color…).
   ========================================================== */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { enums } from "@erp-framework/db";
import { router, rbacProcedure } from "./trpc";

const NAME_RE = /^[a-z][a-z0-9_]*$/;

const enumValue = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  labelEn: z.string().optional(),
});

const enumInput = z.object({
  name: z.string().regex(NAME_RE, "name phải snake_case bắt đầu bằng chữ"),
  label: z.string().min(1),
  labelEn: z.string().optional(),
  description: z.string().optional(),
  values: z.array(enumValue),
  enabled: z.boolean().optional(),
});

export const enumsRouter = router({
  list: rbacProcedure("view", "enum")
    .query(({ ctx }) => ctx.db.select().from(enums)
      .where(eq(enums.companyId, ctx.user.companyId))
      .orderBy(desc(enums.updatedAt))),

  get: rbacProcedure("view", "enum")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db.select().from(enums)
        .where(and(eq(enums.id, input),
          eq(enums.companyId, ctx.user.companyId)));
      return row ?? null;
    }),

  save: rbacProcedure("edit", "enum")
    .input(enumInput)
    .mutation(async ({ ctx, input }) => {
      const values = {
        label: input.label,
        labelEn: input.labelEn ?? null,
        description: input.description ?? null,
        values: input.values,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        updatedAt: new Date(),
      };
      const [ex] = await ctx.db.select({ id: enums.id })
        .from(enums)
        .where(and(eq(enums.companyId, ctx.user.companyId),
          eq(enums.name, input.name)));
      if (ex) {
        const [row] = await ctx.db.update(enums)
          .set(values).where(eq(enums.id, ex.id)).returning();
        return row;
      }
      const [row] = await ctx.db.insert(enums).values({
        companyId: ctx.user.companyId,
        name: input.name,
        createdBy: ctx.user.id,
        ...values,
      }).returning();
      return row;
    }),

  setEnabled: rbacProcedure("edit", "enum")
    .input(z.object({ id: z.string().uuid(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(enums)
        .set({ enabled: input.enabled, updatedAt: new Date() })
        .where(and(eq(enums.id, input.id),
          eq(enums.companyId, ctx.user.companyId)));
      return { ok: true };
    }),

  delete: rbacProcedure("delete", "enum")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(enums).where(and(
        eq(enums.id, input),
        eq(enums.companyId, ctx.user.companyId)));
    }),
});
