/* ==========================================================
   plugins-router.ts — Plugin registry theo công ty.
   Lưu manifest plugin + cờ bật/tắt; cho phép bật/tắt lúc chạy
   (không cần build lại) và xuất/nhập manifest để chia sẻ.
   - list       : plugin đã đăng ký của công ty
   - save       : đăng ký / cập nhật plugin (upsert theo name)
   - setEnabled : bật / tắt một plugin
   - delete     : gỡ đăng ký plugin
   - export     : lấy manifest một plugin để chia sẻ/publish
   ========================================================== */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { pluginRegistrations } from "@erp-framework/db";
import { router, rbacProcedure } from "./trpc";

export const pluginsRouter = router({
  list: rbacProcedure("view", "settings")
    .query(({ ctx }) => ctx.db.select().from(pluginRegistrations)
      .where(eq(pluginRegistrations.companyId, ctx.user.companyId))
      .orderBy(desc(pluginRegistrations.createdAt))),

  save: rbacProcedure("edit", "settings")
    .input(z.object({
      name: z.string().min(1),
      version: z.string().optional(),
      manifest: z.record(z.string(), z.unknown()).optional(),
      enabled: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [ex] = await ctx.db.select({ id: pluginRegistrations.id })
        .from(pluginRegistrations)
        .where(and(eq(pluginRegistrations.companyId, ctx.user.companyId),
          eq(pluginRegistrations.name, input.name)));
      const values = {
        version: input.version ?? "1.0.0",
        ...(input.manifest !== undefined ? { manifest: input.manifest } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      };
      if (ex) {
        const [row] = await ctx.db.update(pluginRegistrations)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(pluginRegistrations.id, ex.id)).returning();
        return row;
      }
      const [row] = await ctx.db.insert(pluginRegistrations)
        .values({ companyId: ctx.user.companyId, name: input.name, ...values })
        .returning();
      return row;
    }),

  setEnabled: rbacProcedure("edit", "settings")
    .input(z.object({ id: z.string().uuid(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(pluginRegistrations)
        .set({ enabled: input.enabled, updatedAt: new Date() })
        .where(and(eq(pluginRegistrations.id, input.id),
          eq(pluginRegistrations.companyId, ctx.user.companyId)));
      return { ok: true };
    }),

  delete: rbacProcedure("edit", "settings")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(pluginRegistrations).where(and(
        eq(pluginRegistrations.id, input),
        eq(pluginRegistrations.companyId, ctx.user.companyId)));
    }),

  // Xuất manifest một plugin để chia sẻ / publish.
  export: rbacProcedure("view", "settings")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db.select().from(pluginRegistrations)
        .where(and(eq(pluginRegistrations.id, input),
          eq(pluginRegistrations.companyId, ctx.user.companyId)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Plugin không tồn tại" });
      return { name: row.name, version: row.version, manifest: row.manifest };
    }),
});
