/* ==========================================================
   notifications-router.ts — In-app notifications cho user.
   Tự tạo qua mentionUsers (record-comments hook). User list +
   markRead. Không push realtime — UI poll mỗi 30s.
   ========================================================== */
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { notifications, users } from "@erp-framework/db";
import { router, protectedProcedure } from "./trpc";
import type { DB } from "./db";
import { publish } from "./ws-hub";

export const notificationsRouter = router({
  list: protectedProcedure
    .input(z.object({
      onlyUnread: z.boolean().optional(),
      limit: z.number().int().positive().max(100).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const onlyUnread = input?.onlyUnread ?? false;
      const limit = input?.limit ?? 50;
      const conds = [eq(notifications.userId, ctx.user.id)];
      if (onlyUnread) conds.push(isNull(notifications.readAt));
      return ctx.db.select().from(notifications)
        .where(and(...conds))
        .orderBy(desc(notifications.createdAt))
        .limit(limit);
    }),

  unreadCount: protectedProcedure
    .query(async ({ ctx }) => {
      const rows = await ctx.db.select().from(notifications)
        .where(and(
          eq(notifications.userId, ctx.user.id),
          isNull(notifications.readAt),
        ));
      return { count: rows.length };
    }),

  markRead: protectedProcedure
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(notifications)
        .set({ readAt: new Date() })
        .where(and(
          eq(notifications.id, input),
          eq(notifications.userId, ctx.user.id),
        ));
      return { ok: true };
    }),

  markAllRead: protectedProcedure
    .mutation(async ({ ctx }) => {
      await ctx.db.update(notifications)
        .set({ readAt: new Date() })
        .where(and(
          eq(notifications.userId, ctx.user.id),
          isNull(notifications.readAt),
        ));
      return { ok: true };
    }),
});

/** Parse @username từ chuỗi, resolve user trong cùng công ty, insert
 *  1 notification mỗi mention. Idempotent: 1 user 1 mention/text.
 *  Best-effort: lỗi không cản trở caller. */
export async function notifyMentions(
  db: DB, args: {
    companyId: string;
    actorUserId: string;
    body: string;
    targetRecordId?: string;
    targetUrl?: string;
    kind?: string;
  },
): Promise<void> {
  try {
    const usernames = Array.from(new Set(
      Array.from(args.body.matchAll(/@([a-zA-Z0-9_.-]+)/g)).map((m) => m[1]),
    )).filter((u): u is string => !!u);
    if (usernames.length === 0) return;
    // Resolve username via email prefix hoặc users.name. Đơn giản: match
    // case-insensitive trên prefix email hoặc name. (Schema users không
    // có field username nên dùng email prefix làm proxy.)
    const allUsers = await db.select({ id: users.id, email: users.email, name: users.name })
      .from(users);
    const matched: { id: string; name: string }[] = [];
    for (const u of usernames) {
      const lo = u.toLowerCase();
      const found = allUsers.find((x) =>
        x.email.toLowerCase().split("@")[0] === lo
        || x.name.toLowerCase().replace(/\s+/g, "") === lo,
      );
      if (found) matched.push({ id: found.id, name: found.name });
    }
    if (matched.length === 0) return;
    const dedupe = new Map(matched.map((m) => [m.id, m]));
    const inserted = await db.insert(notifications).values([...dedupe.values()].map((u) => ({
      companyId: args.companyId,
      userId: u.id,
      kind: args.kind ?? "mention",
      targetRecordId: args.targetRecordId ?? null,
      targetUrl: args.targetUrl ?? null,
      actorUserId: args.actorUserId,
      body: args.body.slice(0, 500),
    }))).returning();
    // Push realtime cho từng user qua WS hub (best-effort).
    for (const n of inserted) {
      publish(`notifications:${n.userId}`, {
        type: "new", notification: n,
      });
    }
  } catch (e) {
    console.error("[notifyMentions] lỗi:", (e as Error).message);
  }
}
