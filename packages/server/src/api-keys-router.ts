/* ==========================================================
   api-keys-router.ts — CRUD API key per company.
   Plaintext key chỉ trả về 1 lần lúc tạo (sk_xxx); sau đó chỉ
   lưu hash. scopes JSONB array — empty = full access.
   ========================================================== */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { apiKeys } from "@erp-framework/db";
import { router, rbacProcedure } from "./trpc";

/** Sinh key plaintext "sk_<48 hex>" + client_id (cho OAuth flow).
 *  prefix = "sk_" + 8 ký tự đầu để hiển thị partial trong UI. */
function generateApiKey(): {
  plaintext: string; hash: string; prefix: string; clientId: string;
} {
  const rand = randomBytes(24).toString("hex");
  const plaintext = `sk_${rand}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");
  const prefix = `sk_${rand.slice(0, 8)}`;
  const clientId = `cli_${randomBytes(8).toString("hex")}`;
  return { plaintext, hash, prefix, clientId };
}

export const apiKeysRouter = router({
  list: rbacProcedure("view", "settings")
    .query(({ ctx }) => ctx.db.select({
      id: apiKeys.id, label: apiKeys.label, prefix: apiKeys.prefix,
      clientId: apiKeys.clientId,
      scopes: apiKeys.scopes, enabled: apiKeys.enabled,
      lastUsedAt: apiKeys.lastUsedAt, createdAt: apiKeys.createdAt,
    }).from(apiKeys)
      .where(eq(apiKeys.companyId, ctx.user.companyId))
      .orderBy(desc(apiKeys.createdAt))),

  create: rbacProcedure("edit", "settings")
    .input(z.object({
      label: z.string().min(1),
      scopes: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { plaintext, hash, prefix, clientId } = generateApiKey();
      const [row] = await ctx.db.insert(apiKeys).values({
        companyId: ctx.user.companyId,
        label: input.label,
        keyHash: hash,
        prefix,
        clientId,
        scopes: input.scopes ?? [],
        createdBy: ctx.user.id,
      }).returning();
      return { id: row?.id, plaintext, prefix, clientId };
    }),

  setEnabled: rbacProcedure("edit", "settings")
    .input(z.object({ id: z.string().uuid(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(apiKeys).set({ enabled: input.enabled })
        .where(and(eq(apiKeys.id, input.id),
          eq(apiKeys.companyId, ctx.user.companyId)));
      return { ok: true };
    }),

  delete: rbacProcedure("edit", "settings")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(apiKeys).where(and(
        eq(apiKeys.id, input),
        eq(apiKeys.companyId, ctx.user.companyId),
      ));
    }),
});
