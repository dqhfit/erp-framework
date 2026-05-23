/* ==========================================================
   backup-router.ts — tRPC admin cho cấu hình + chạy backup.
   Quyền: rbacProcedure("view"|"edit", "settings") — backup là
   cấu hình hệ thống, không tạo object type riêng.
   ========================================================== */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { backupConfig, backupRuns } from "@erp-framework/db";
import { router, rbacProcedure } from "./trpc";
import { encryptSecret } from "./crypto";
import { testBackupConfig } from "./backup";
import { enqueueBackupRun } from "./jobs";

export const backupRouter = router({
  config: router({
    /** Trả về cấu hình hiện tại (không gồm key thô). */
    get: rbacProcedure("view", "settings").query(async ({ ctx }) => {
      const [cfg] = await ctx.db.select({
        id: backupConfig.id,
        gdriveFolderId: backupConfig.gdriveFolderId,
        scheduleCron: backupConfig.scheduleCron,
        // Có key đã đặt hay chưa — không trả nội dung.
        hasKey: backupConfig.gdriveKeyEnc,
        updatedAt: backupConfig.updatedAt,
      }).from(backupConfig)
        .where(eq(backupConfig.companyId, ctx.user.companyId));
      if (!cfg) return null;
      return {
        gdriveFolderId: cfg.gdriveFolderId,
        scheduleCron: cfg.scheduleCron,
        hasKey: !!cfg.hasKey,
        updatedAt: cfg.updatedAt,
      };
    }),

    /** Lưu cấu hình. keyJson chỉ truyền khi đổi key. */
    save: rbacProcedure("edit", "settings")
      .input(z.object({
        gdriveFolderId: z.string().min(1),
        keyJson: z.string().optional(),
        scheduleCron: z.string().nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db.select()
          .from(backupConfig)
          .where(eq(backupConfig.companyId, ctx.user.companyId));
        if (existing) {
          const set: Record<string, unknown> = {
            gdriveFolderId: input.gdriveFolderId,
            scheduleCron: input.scheduleCron ?? null,
            updatedAt: new Date(),
          };
          if (input.keyJson) set.gdriveKeyEnc = encryptSecret(input.keyJson);
          await ctx.db.update(backupConfig).set(set)
            .where(eq(backupConfig.id, existing.id));
        } else {
          if (!input.keyJson) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Cần JSON service account key lần đầu cấu hình.",
            });
          }
          await ctx.db.insert(backupConfig).values({
            companyId: ctx.user.companyId,
            gdriveKeyEnc: encryptSecret(input.keyJson),
            gdriveFolderId: input.gdriveFolderId,
            scheduleCron: input.scheduleCron ?? null,
          });
        }
        return { ok: true };
      }),

    /** Test kết nối — gọi Drive với key + folder để xác minh. */
    test: rbacProcedure("edit", "settings")
      .input(z.object({
        keyJson: z.string().min(1),
        gdriveFolderId: z.string().min(1),
      }))
      .mutation(({ input }) =>
        testBackupConfig(input.keyJson, input.gdriveFolderId)),
  }),

  /** Đưa job backup vào hàng đợi. Trả runId để client theo dõi. */
  runNow: rbacProcedure("edit", "settings").mutation(async ({ ctx }) => {
    const runId = await enqueueBackupRun(ctx.user.companyId, "manual");
    return { runId };
  }),

  runs: router({
    list: rbacProcedure("view", "settings")
      .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }))
      .query(({ ctx, input }) => ctx.db.select().from(backupRuns)
        .where(eq(backupRuns.companyId, ctx.user.companyId))
        .orderBy(desc(backupRuns.startedAt))
        .limit(input.limit)),
  }),
});
