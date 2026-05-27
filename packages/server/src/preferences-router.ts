/* preferences-router.ts — Lưu/nạp cài đặt giao diện per-user.
   Dùng protectedProcedure (không cần companyId — prefs là per-user). */
import { users } from "@erp-framework/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "./trpc";

export const preferencesRouter = router({
  load: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({ preferences: users.preferences })
      .from(users)
      .where(eq(users.id, ctx.user.id));
    return (row?.preferences ?? {}) as Record<string, unknown>;
  }),

  save: protectedProcedure
    .input(z.record(z.string(), z.unknown()))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(users).set({ preferences: input }).where(eq(users.id, ctx.user.id));
    }),
});
