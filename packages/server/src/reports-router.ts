/* ==========================================================
   reports-router.ts — Audit compliance report (GDPR/SOC2).
   Export activity_log + audit_log_immutable + record_versions
   trong khoảng date — CSV/JSON cho compliance officer.
   ========================================================== */
import { z } from "zod";
import { and, eq, gte, lte } from "drizzle-orm";
import { activityLog, auditLogImmutable, entityRecordVersions, auditReports } from "@erp-framework/db";
import { router, rbacProcedure } from "./trpc";

export const reportsRouter = router({
  audit: rbacProcedure("view", "activity")
    .input(z.object({
      fromDate: z.string().datetime(),
      toDate: z.string().datetime(),
      kinds: z.array(z.enum(["activity", "immutable", "record_versions"])).optional(),
      format: z.enum(["json", "csv"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const from = new Date(input.fromDate);
      const to = new Date(input.toDate);
      const kinds = input.kinds ?? ["activity", "immutable", "record_versions"];
      const out: Record<string, unknown[]> = {};
      let totalRows = 0;

      if (kinds.includes("activity")) {
        out.activity = await ctx.db.select().from(activityLog).where(and(
          eq(activityLog.companyId, ctx.user.companyId),
          gte(activityLog.at, from),
          lte(activityLog.at, to),
        ));
        totalRows += out.activity.length;
      }
      if (kinds.includes("immutable")) {
        out.immutable = await ctx.db.select().from(auditLogImmutable).where(and(
          eq(auditLogImmutable.companyId, ctx.user.companyId),
          gte(auditLogImmutable.createdAt, from),
          lte(auditLogImmutable.createdAt, to),
        ));
        totalRows += out.immutable.length;
      }
      if (kinds.includes("record_versions")) {
        out.recordVersions = await ctx.db.select().from(entityRecordVersions).where(and(
          eq(entityRecordVersions.companyId, ctx.user.companyId),
          gte(entityRecordVersions.createdAt, from),
          lte(entityRecordVersions.createdAt, to),
        ));
        totalRows += out.recordVersions.length;
      }

      // Track việc export — tự audit-log compliance.
      await ctx.db.insert(auditReports).values({
        companyId: ctx.user.companyId,
        kind: kinds.join("+"),
        fromDate: from, toDate: to,
        rowCount: totalRows,
        requestedBy: ctx.user.id,
      });

      if (input.format === "csv") {
        // CSV: 1 file per kind, gộp thành Markdown sections.
        const sections = Object.entries(out).map(([kind, rows]) => {
          if (!Array.isArray(rows) || rows.length === 0) return `## ${kind}\n(empty)\n`;
          const headers = Object.keys((rows[0] ?? {}) as Record<string, unknown>);
          const lines = [
            `## ${kind}`,
            headers.join(","),
            ...rows.map((r) => headers.map((h) =>
              JSON.stringify(((r as Record<string, unknown>)[h] ?? ""))).join(",")),
          ];
          return lines.join("\n");
        });
        return { format: "csv" as const, content: sections.join("\n\n"), rowCount: totalRows };
      }

      return { format: "json" as const, data: out, rowCount: totalRows };
    }),

  list: rbacProcedure("view", "activity")
    .query(({ ctx }) => ctx.db.select().from(auditReports)
      .where(eq(auditReports.companyId, ctx.user.companyId))),
});
