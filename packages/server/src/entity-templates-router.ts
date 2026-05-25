/* ==========================================================
   entity-templates-router.ts — Print/email templates per entity.
   Body Mustache-like {{field}} substitution. Render endpoint trả
   subject + body đã expand với data của record cụ thể.
   ========================================================== */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { entityTemplates, entityRecords } from "@erp-framework/db";
import { router, rbacProcedure } from "./trpc";

const templateInput = z.object({
  entityId: z.string().uuid(),
  kind: z.enum(["print", "email"]),
  name: z.string().min(1),
  subject: z.string().optional(),
  body: z.string().min(1),
  enabled: z.boolean().optional(),
});

/** Expand {{field}} / {{field.sub}} với data. Field thiếu → giữ token rỗng. */
function expand(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z_$][\w$.]*)\s*\}\}/g, (_, path: string) => {
    const parts = path.split(".");
    let v: unknown = data;
    for (const p of parts) {
      if (v && typeof v === "object" && p in (v as Record<string, unknown>)) {
        v = (v as Record<string, unknown>)[p];
      } else {
        v = undefined; break;
      }
    }
    if (v == null) return "";
    return typeof v === "string" ? v : JSON.stringify(v);
  });
}

export const entityTemplatesRouter = router({
  list: rbacProcedure("view", "entity")
    .input(z.string().uuid())
    .query(({ ctx, input }) =>
      ctx.db.select().from(entityTemplates)
        .where(and(
          eq(entityTemplates.companyId, ctx.user.companyId),
          eq(entityTemplates.entityId, input),
        ))
        .orderBy(desc(entityTemplates.updatedAt))),

  save: rbacProcedure("edit", "entity")
    .input(templateInput.extend({ id: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const values = {
        kind: input.kind, name: input.name,
        subject: input.subject ?? null, body: input.body,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        updatedAt: new Date(),
      };
      if (input.id) {
        const [row] = await ctx.db.update(entityTemplates)
          .set(values).where(and(
            eq(entityTemplates.id, input.id),
            eq(entityTemplates.companyId, ctx.user.companyId),
          )).returning();
        return row;
      }
      const [row] = await ctx.db.insert(entityTemplates).values({
        companyId: ctx.user.companyId,
        entityId: input.entityId,
        createdBy: ctx.user.id,
        ...values,
      }).returning();
      return row;
    }),

  delete: rbacProcedure("edit", "entity")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(entityTemplates).where(and(
        eq(entityTemplates.id, input),
        eq(entityTemplates.companyId, ctx.user.companyId),
      ));
    }),

  render: rbacProcedure("view", "entity")
    .input(z.object({
      templateId: z.string().uuid(),
      recordId: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      const [tpl] = await ctx.db.select().from(entityTemplates)
        .where(and(
          eq(entityTemplates.id, input.templateId),
          eq(entityTemplates.companyId, ctx.user.companyId),
        ));
      if (!tpl) throw new TRPCError({ code: "NOT_FOUND", message: "Template không tồn tại" });
      const [rec] = await ctx.db.select({ data: entityRecords.data }).from(entityRecords)
        .where(and(
          eq(entityRecords.id, input.recordId),
          eq(entityRecords.companyId, ctx.user.companyId),
        ));
      if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "Record không tồn tại" });
      const data = (rec.data ?? {}) as Record<string, unknown>;
      return {
        kind: tpl.kind,
        subject: tpl.subject ? expand(tpl.subject, data) : null,
        body: expand(tpl.body, data),
      };
    }),
});
