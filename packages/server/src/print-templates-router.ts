/* ==========================================================
   print-templates-router.ts — tRPC CRUD template in + scaffold từ report
   + render preview HTML. Route nhị phân (PDF/HTML) ở /print/:id (index.ts).
   ========================================================== */

import { legacyReports, printTemplates } from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { renderTemplate, scaffoldTemplateFromReport } from "./print-render";
import { rbacProcedure, router } from "./trpc";

const nameSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, "name phải snake_case");

export const printTemplatesRouter = router({
  list: rbacProcedure("view", "settings").query(async ({ ctx }) => {
    return await ctx.db
      .select({
        id: printTemplates.id,
        name: printTemplates.name,
        label: printTemplates.label,
        reportClass: printTemplates.reportClass,
        dataProcedure: printTemplates.dataProcedure,
        pageSize: printTemplates.pageSize,
        orientation: printTemplates.orientation,
        updatedAt: printTemplates.updatedAt,
      })
      .from(printTemplates)
      .where(eq(printTemplates.companyId, ctx.user.companyId));
  }),

  get: rbacProcedure("view", "settings")
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(printTemplates)
        .where(
          and(eq(printTemplates.companyId, ctx.user.companyId), eq(printTemplates.id, input.id)),
        )
        .limit(1);
      return row ?? null;
    }),

  save: rbacProcedure("edit", "settings")
    .input(
      z.object({
        id: z.string().uuid().optional(),
        name: nameSchema,
        label: z.string().min(1),
        reportClass: z.string().optional(),
        dataProcedure: z.string().optional(),
        html: z.string().default(""),
        pageSize: z.string().default("A4"),
        orientation: z.enum(["portrait", "landscape"]).default("portrait"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const values = {
        companyId: ctx.user.companyId,
        name: input.name,
        label: input.label,
        reportClass: input.reportClass ?? null,
        dataProcedure: input.dataProcedure ?? null,
        html: input.html,
        pageSize: input.pageSize,
        orientation: input.orientation,
        updatedAt: new Date(),
      };
      const [row] = await ctx.db
        .insert(printTemplates)
        .values(input.id ? { id: input.id, ...values } : values)
        .onConflictDoUpdate({
          target: [printTemplates.companyId, printTemplates.name],
          set: {
            label: values.label,
            reportClass: values.reportClass,
            dataProcedure: values.dataProcedure,
            html: values.html,
            pageSize: values.pageSize,
            orientation: values.orientation,
            updatedAt: new Date(),
          },
        })
        .returning({ id: printTemplates.id });
      return { id: row!.id };
    }),

  delete: rbacProcedure("edit", "settings")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(printTemplates)
        .where(
          and(eq(printTemplates.companyId, ctx.user.companyId), eq(printTemplates.id, input.id)),
        );
      return { ok: true };
    }),

  /** Scaffold template từ 1 report blueprint (legacy_reports) → upsert. */
  scaffoldFromReport: rbacProcedure("edit", "settings")
    .input(z.object({ reportClass: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [rep] = await ctx.db
        .select()
        .from(legacyReports)
        .where(
          and(
            eq(legacyReports.companyId, ctx.user.companyId),
            eq(legacyReports.reportClass, input.reportClass),
          ),
        )
        .limit(1);
      if (!rep) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Chưa có blueprint report này — chạy 'Phân tích báo cáo' trước.",
        });
      }
      const html = scaffoldTemplateFromReport({
        reportClass: rep.reportClass,
        title: rep.title,
        columns: (rep.columns as string[]) ?? [],
        dataProcs: (rep.dataProcs as string[]) ?? [],
        kind: rep.kind,
      });
      const name = rep.reportClass
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
      const [row] = await ctx.db
        .insert(printTemplates)
        .values({
          companyId: ctx.user.companyId,
          name,
          label: rep.title ?? rep.reportClass,
          reportClass: rep.reportClass,
          dataProcedure: (rep.dataProcs as string[])?.[0] ?? null,
          html,
        })
        .onConflictDoUpdate({
          target: [printTemplates.companyId, printTemplates.name],
          set: { html, label: rep.title ?? rep.reportClass, updatedAt: new Date() },
        })
        .returning({ id: printTemplates.id });
      return { id: row!.id, name, label: rep.title ?? rep.reportClass };
    }),

  /** Render preview HTML với data mẫu (cho FE xem nhanh, không cần proc). */
  renderPreview: rbacProcedure("view", "settings")
    .input(
      z.object({
        id: z.string().uuid(),
        sampleRows: z.array(z.record(z.string(), z.unknown())).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [tpl] = await ctx.db
        .select({ html: printTemplates.html })
        .from(printTemplates)
        .where(
          and(eq(printTemplates.companyId, ctx.user.companyId), eq(printTemplates.id, input.id)),
        )
        .limit(1);
      if (!tpl) throw new TRPCError({ code: "NOT_FOUND", message: "Template không tồn tại." });
      const rows = input.sampleRows ?? [{}, {}, {}];
      const html = renderTemplate(tpl.html, { rows, so_chung_tu: "(mẫu)", ngay: "(mẫu)" });
      return { html };
    }),
});
