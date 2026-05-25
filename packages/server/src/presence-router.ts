/* ==========================================================
   presence-router.ts — Presence "đang xem" per record per user.
   Client ping mỗi 15s; server UPSERT last_seen. list trả user
   active trong 30s gần nhất (TTL implicit). v2 sẽ thay WebSocket.
   ========================================================== */
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { recordPresence, entityRecords, users } from "@erp-framework/db";
import { router, rbacProcedure } from "./trpc";

const TTL_SECONDS = 30;

export const presenceRouter = router({
  ping: rbacProcedure("view", "entity")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      // Verify record cùng công ty.
      const [rec] = await ctx.db.select({ id: entityRecords.id }).from(entityRecords)
        .where(and(eq(entityRecords.id, input),
          eq(entityRecords.companyId, ctx.user.companyId)));
      if (!rec) return { ok: false };
      // UPSERT — drizzle onConflictDoUpdate.
      await ctx.db.insert(recordPresence).values({
        recordId: input,
        userId: ctx.user.id,
        companyId: ctx.user.companyId,
      }).onConflictDoUpdate({
        target: [recordPresence.recordId, recordPresence.userId],
        set: { lastSeen: new Date() },
      });
      return { ok: true };
    }),

  list: rbacProcedure("view", "entity")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.select({
        userId: recordPresence.userId,
        lastSeen: recordPresence.lastSeen,
        name: users.name,
        email: users.email,
      }).from(recordPresence)
        .leftJoin(users, eq(users.id, recordPresence.userId))
        .where(and(
          eq(recordPresence.recordId, input),
          eq(recordPresence.companyId, ctx.user.companyId),
          sql`${recordPresence.lastSeen} > now() - interval '${sql.raw(String(TTL_SECONDS))} seconds'`,
        ));
      return rows.filter((r) => r.userId !== ctx.user.id);
    }),
});
