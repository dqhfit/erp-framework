/* ==========================================================
   entity-webhooks-router.ts — Outgoing webhooks per entity.
   Fire-and-forget HTTP POST khi event = create/update/delete.
   HMAC-SHA256 signature qua secret. Caller phải verify chữ ký
   trước khi tin payload.
   ========================================================== */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { entityWebhooks } from "@erp-framework/db";
import { router, rbacProcedure } from "./trpc";
import type { DB } from "./db";

const webhookInput = z.object({
  entityId: z.string().uuid(),
  name: z.string().min(1),
  url: z.string().url(),
  events: z.array(z.enum(["create", "update", "delete"])).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  secret: z.string().optional(),
  enabled: z.boolean().optional(),
});

export const entityWebhooksRouter = router({
  list: rbacProcedure("view", "settings")
    .input(z.string().uuid())
    .query(({ ctx, input }) =>
      ctx.db.select().from(entityWebhooks)
        .where(and(
          eq(entityWebhooks.companyId, ctx.user.companyId),
          eq(entityWebhooks.entityId, input),
        ))
        .orderBy(desc(entityWebhooks.updatedAt))),

  save: rbacProcedure("edit", "settings")
    .input(webhookInput.extend({ id: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const values = {
        name: input.name, url: input.url,
        events: input.events ?? ["create", "update", "delete"],
        headers: input.headers ?? null,
        secret: input.secret ?? null,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        updatedAt: new Date(),
      };
      if (input.id) {
        const [row] = await ctx.db.update(entityWebhooks)
          .set(values).where(and(
            eq(entityWebhooks.id, input.id),
            eq(entityWebhooks.companyId, ctx.user.companyId),
          )).returning();
        return row;
      }
      const [row] = await ctx.db.insert(entityWebhooks).values({
        companyId: ctx.user.companyId,
        entityId: input.entityId,
        createdBy: ctx.user.id,
        ...values,
      }).returning();
      return row;
    }),

  delete: rbacProcedure("edit", "settings")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(entityWebhooks).where(and(
        eq(entityWebhooks.id, input),
        eq(entityWebhooks.companyId, ctx.user.companyId),
      ));
    }),
});

/** Fire-and-forget cho tất cả webhook khớp (entityId, event). Không await
 *  thành công — chỉ best-effort + cập nhật lastFiredAt/lastStatus. Lỗi
 *  in console, không cản trở caller (records.create/update/delete). */
export function fireEntityWebhooks(
  db: DB,
  args: {
    companyId: string;
    entityId: string;
    event: "create" | "update" | "delete";
    record: unknown;
    before?: unknown;
    after?: unknown;
  },
): void {
  // Async không await — caller không bị block.
  void (async () => {
    try {
      const hooks = await db.select().from(entityWebhooks)
        .where(and(
          eq(entityWebhooks.companyId, args.companyId),
          eq(entityWebhooks.entityId, args.entityId),
          eq(entityWebhooks.enabled, true),
        ));
      for (const h of hooks) {
        const events = (h.events ?? []) as string[];
        if (!events.includes(args.event)) continue;
        const body = JSON.stringify({
          event: args.event,
          companyId: args.companyId,
          entityId: args.entityId,
          record: args.record,
          before: args.before,
          after: args.after,
          ts: new Date().toISOString(),
        });
        const sig = h.secret
          ? createHmac("sha256", h.secret).update(body).digest("hex")
          : "";
        const headers: Record<string, string> = {
          "content-type": "application/json",
          "x-erp-event": args.event,
          ...(sig ? { "x-erp-signature": `sha256=${sig}` } : {}),
          ...((h.headers ?? {}) as Record<string, string>),
        };
        try {
          const res = await fetch(h.url, { method: "POST", headers, body });
          await db.update(entityWebhooks).set({
            lastFiredAt: new Date(), lastStatus: res.status, updatedAt: new Date(),
          }).where(eq(entityWebhooks.id, h.id));
        } catch (e) {
          console.error(`[entity-webhook ${h.name}] lỗi gọi ${h.url}:`, (e as Error).message);
          await db.update(entityWebhooks).set({
            lastFiredAt: new Date(), lastStatus: 0, updatedAt: new Date(),
          }).where(eq(entityWebhooks.id, h.id));
        }
      }
    } catch (e) {
      console.error("[entity-webhooks] scan/fire lỗi:", (e as Error).message);
    }
  })();
}
