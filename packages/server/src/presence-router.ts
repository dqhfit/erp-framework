/* ==========================================================
   presence-router.ts — Presence "đang xem" per record per user.
   Client ping mỗi 15s; server UPSERT last_seen. list trả user
   active trong 30s gần nhất (TTL implicit). v2 sẽ thay WebSocket.
   ========================================================== */

import { recordPresence, users } from "@erp-framework/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getRecordStore } from "./record-store";
import { rbacProcedure, router } from "./trpc";
import { publish } from "./ws-hub";

const TTL_SECONDS = 30;

export const presenceRouter = router({
  ping: rbacProcedure("view", "entity")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      // Verify record cùng công ty (qua store — HYBRID-aware bảng thật/EAV).
      const rec = await getRecordStore(ctx.db).getById(ctx.user.companyId, input);
      if (!rec) return { ok: false };
      // UPSERT — drizzle onConflictDoUpdate.
      await ctx.db
        .insert(recordPresence)
        .values({
          recordId: input,
          userId: ctx.user.id,
          companyId: ctx.user.companyId,
        })
        .onConflictDoUpdate({
          target: [recordPresence.recordId, recordPresence.userId],
          set: { lastSeen: new Date() },
        });
      // Broadcast cho subscribers presence:<recordId> — UI nhận update
      // mà không cần poll list lại.
      publish(`presence:${input}`, {
        type: "ping",
        userId: ctx.user.id,
        ts: Date.now(),
      });
      return { ok: true };
    }),

  list: rbacProcedure("view", "entity")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          userId: recordPresence.userId,
          lastSeen: recordPresence.lastSeen,
          name: users.name,
          email: users.email,
        })
        .from(recordPresence)
        .leftJoin(users, eq(users.id, recordPresence.userId))
        .where(
          and(
            eq(recordPresence.recordId, input),
            eq(recordPresence.companyId, ctx.user.companyId),
            sql`${recordPresence.lastSeen} > now() - interval '${sql.raw(String(TTL_SECONDS))} seconds'`,
          ),
        );
      return rows.filter((r) => r.userId !== ctx.user.id);
    }),
});
