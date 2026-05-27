/* ==========================================================
   entity-webhooks-router.ts — Outgoing webhooks per entity.
   Fire-and-forget HTTP POST khi event = create/update/delete.
   HMAC-SHA256 signature qua secret. Caller phải verify chữ ký
   trước khi tin payload.
   ========================================================== */

import { createHmac } from "node:crypto";
import { entityWebhooks } from "@erp-framework/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "./db";
import { rbacProcedure, router } from "./trpc";

/** Chặn SSRF: reject URL trỏ vào localhost / private RFC1918 range.
 *  Lưu ý: check chỉ theo hostname tại thời điểm save. Để chống DNS-rebinding
 *  hoàn toàn cần resolve IP tại lúc fire — hiện giảm thiểu qua redirect:"error". */
function assertPublicWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("URL webhook không hợp lệ");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("URL webhook phải dùng http hoặc https");
  }
  const hostname = parsed.hostname.toLowerCase();
  const blocked = [
    /^localhost$/,
    /^127\./,
    /^0\.0\.0\.0$/,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^::1$/,
    /^fc00:/,
    /^fe80:/,
    /^169\.254\./,
  ];
  if (blocked.some((re) => re.test(hostname))) {
    throw new Error(`URL webhook không được trỏ vào địa chỉ nội bộ: ${hostname}`);
  }
}

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
      ctx.db
        .select()
        .from(entityWebhooks)
        .where(
          and(eq(entityWebhooks.companyId, ctx.user.companyId), eq(entityWebhooks.entityId, input)),
        )
        .orderBy(desc(entityWebhooks.updatedAt)),
    ),

  save: rbacProcedure("edit", "settings")
    .input(webhookInput.extend({ id: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      assertPublicWebhookUrl(input.url);
      const values = {
        name: input.name,
        url: input.url,
        events: input.events ?? ["create", "update", "delete"],
        headers: input.headers ?? null,
        secret: input.secret ?? null,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        updatedAt: new Date(),
      };
      if (input.id) {
        const [row] = await ctx.db
          .update(entityWebhooks)
          .set(values)
          .where(
            and(eq(entityWebhooks.id, input.id), eq(entityWebhooks.companyId, ctx.user.companyId)),
          )
          .returning();
        return row;
      }
      const [row] = await ctx.db
        .insert(entityWebhooks)
        .values({
          companyId: ctx.user.companyId,
          entityId: input.entityId,
          createdBy: ctx.user.id,
          ...values,
        })
        .returning();
      return row;
    }),

  delete: rbacProcedure("edit", "settings")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(entityWebhooks)
        .where(and(eq(entityWebhooks.id, input), eq(entityWebhooks.companyId, ctx.user.companyId)));
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
      const hooks = await db
        .select()
        .from(entityWebhooks)
        .where(
          and(
            eq(entityWebhooks.companyId, args.companyId),
            eq(entityWebhooks.entityId, args.entityId),
            eq(entityWebhooks.enabled, true),
          ),
        );
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
        const sig = h.secret ? createHmac("sha256", h.secret).update(body).digest("hex") : "";
        const headers: Record<string, string> = {
          "content-type": "application/json",
          "x-erp-event": args.event,
          ...(sig ? { "x-erp-signature": `sha256=${sig}` } : {}),
          ...((h.headers ?? {}) as Record<string, string>),
        };
        try {
          // redirect: "error" chặn server không follow redirect sang IP nội bộ
          // (giảm thiểu DNS-rebinding — hostname được validate lúc save).
          const res = await fetch(h.url, { method: "POST", headers, body, redirect: "error" });
          await db
            .update(entityWebhooks)
            .set({
              lastFiredAt: new Date(),
              lastStatus: res.status,
              updatedAt: new Date(),
            })
            .where(eq(entityWebhooks.id, h.id));
        } catch (e) {
          console.error(`[entity-webhook ${h.name}] lỗi gọi ${h.url}:`, (e as Error).message);
          await db
            .update(entityWebhooks)
            .set({
              lastFiredAt: new Date(),
              lastStatus: 0,
              updatedAt: new Date(),
            })
            .where(eq(entityWebhooks.id, h.id));
        }
      }
    } catch (e) {
      console.error("[entity-webhooks] scan/fire lỗi:", (e as Error).message);
    }
  })();
}
