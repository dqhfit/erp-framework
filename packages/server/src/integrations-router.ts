/* ==========================================================
   integrations-router.ts — tRPC router quản lý cấu hình
   tích hợp bên thứ ba per-company (SearXNG, ...).

   Quyền: rbacProcedure("view"|"edit", "settings") — giống
   backup-router, tích hợp là cấu hình hệ thống.
   ========================================================== */

import { companyIntegrationSecrets } from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { encryptSecret } from "./crypto";
import { rbacProcedure, router } from "./trpc";
import { resolveSearchConfig, webSearch, webSearchRaw } from "./web-search";

/* ─── Helper mask URL — che userinfo, chỉ hiện host ──────── */
function maskEndpoint(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return u.host || rawUrl;
  } catch {
    return rawUrl;
  }
}

/* ─── Router ─────────────────────────────────────────────── */

export const integrationsRouter = router({
  webSearch: router({
    /** Trả thông tin cấu hình SearXNG hiện tại (không lộ URL đầy đủ nếu có auth). */
    get: rbacProcedure("view", "settings").query(async ({ ctx }) => {
      const cfg = await resolveSearchConfig(ctx.db, ctx.user.companyId);
      return {
        configured: cfg.configured,
        source: cfg.source,
        endpointMasked: cfg.configured ? maskEndpoint(cfg.baseUrl) : "(chưa cấu hình)",
      };
    }),

    /** Lưu URL SearXNG per-company (upsert). */
    save: rbacProcedure("edit", "settings")
      .input(z.object({ url: z.string().url() }))
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select()
          .from(companyIntegrationSecrets)
          .where(
            and(
              eq(companyIntegrationSecrets.companyId, ctx.user.companyId),
              eq(companyIntegrationSecrets.provider, "searxng"),
            ),
          )
          .limit(1);

        if (existing) {
          await ctx.db
            .update(companyIntegrationSecrets)
            .set({
              secretEnc: encryptSecret(input.url),
              updatedAt: new Date(),
            })
            .where(eq(companyIntegrationSecrets.id, existing.id));
        } else {
          await ctx.db.insert(companyIntegrationSecrets).values({
            companyId: ctx.user.companyId,
            provider: "searxng",
            secretEnc: encryptSecret(input.url),
          });
        }

        return { ok: true };
      }),

    /** Test kết nối SearXNG.
     *  - Truyền url → test URL đó trực tiếp (không lưu).
     *  - Không truyền url → dùng cấu hình đã lưu của công ty. */
    test: rbacProcedure("edit", "settings")
      .input(z.object({ url: z.string().url().optional() }))
      .mutation(async ({ ctx, input }) => {
        try {
          let results: { title: string; url: string; content: string; score: number }[];
          if (input.url) {
            // Test URL tạm — không ghi DB
            results = await webSearchRaw(input.url, "test", { limit: 3 });
          } else {
            results = await webSearch(ctx.db, ctx.user.companyId, "test", { limit: 3 });
          }
          return { ok: true, count: results.length };
        } catch (err) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: (err as Error).message,
          });
        }
      }),
  }),
});
