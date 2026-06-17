/* ==========================================================
   api-keys-router.ts — CRUD API key per company.
   Plaintext key chỉ trả về 1 lần lúc tạo (sk_xxx); sau đó chỉ
   lưu hash. scopes JSONB array — DENY-BY-DEFAULT (empty = không
   quyền gì). Admin muốn full access phải explicit "*".
   ========================================================== */

import { createHash, randomBytes } from "node:crypto";
import { apiKeys } from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { rbacProcedure, router } from "./trpc";

/** Scope format hợp lệ:
 *  - "*" (full access)
 *  - "entity:<name>:read" | "entity:<name>:write"
 *  - "entity:*:read" | "entity:*:write" (mọi entity, 1 action)
 *  - "feedback:read" | "feedback:propose" | "feedback:apply" | "feedback:*" (MCP /mcp)
 *  - "errors:read" | "errors:write" | "errors:*" (MCP /mcp/errors)
 *  - "migration:read" | "migration:apply" | "migration:*" (MCP /mcp/migration)
 *  - "cad:read" | "cad:write" | "cad:*" (MCP /mcp/cad — máy trạm FreeCAD)
 *  - "backup:read" | "backup:run" | "backup:full" | "backup:*" (MCP /mcp/backup —
 *    máy offsite kéo backup; full = tải dump DB + uploads toàn hệ thống) */
const SCOPE_RE =
  /^(\*|entity:[a-zA-Z0-9_*-]+:(read|write)|feedback:(read|propose|apply|\*)|errors:(read|write|\*)|migration:(read|apply|\*)|cad:(read|write|\*)|backup:(read|run|full|\*))$/;
function validateScopes(scopes: string[]): void {
  if (scopes.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: 'Key không có quyền nào — thêm "*" cho full access hoặc "entity:<name>:read|write".',
    });
  }
  for (const s of scopes) {
    if (!SCOPE_RE.test(s)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Scope "${s}" sai định dạng. Dùng "*" hoặc "entity:<name>:read|write".`,
      });
    }
  }
}

/** Sinh key plaintext "sk_<48 hex>" + client_id (cho OAuth flow).
 *  prefix = "sk_" + 8 ký tự đầu để hiển thị partial trong UI. */
function generateApiKey(): {
  plaintext: string;
  hash: string;
  prefix: string;
  clientId: string;
} {
  const rand = randomBytes(24).toString("hex");
  const plaintext = `sk_${rand}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");
  const prefix = `sk_${rand.slice(0, 8)}`;
  const clientId = `cli_${randomBytes(8).toString("hex")}`;
  return { plaintext, hash, prefix, clientId };
}

export const apiKeysRouter = router({
  list: rbacProcedure("view", "settings").query(({ ctx }) =>
    ctx.db
      .select({
        id: apiKeys.id,
        label: apiKeys.label,
        prefix: apiKeys.prefix,
        clientId: apiKeys.clientId,
        scopes: apiKeys.scopes,
        enabled: apiKeys.enabled,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.companyId, ctx.user.companyId))
      .orderBy(desc(apiKeys.createdAt)),
  ),

  create: rbacProcedure("edit", "settings")
    .input(
      z.object({
        label: z.string().min(1),
        scopes: z.array(z.string()).min(1, "Phải chỉ định ít nhất 1 scope"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      validateScopes(input.scopes);
      const { plaintext, hash, prefix, clientId } = generateApiKey();
      const [row] = await ctx.db
        .insert(apiKeys)
        .values({
          companyId: ctx.user.companyId,
          label: input.label,
          keyHash: hash,
          prefix,
          clientId,
          scopes: input.scopes,
          createdBy: ctx.user.id,
        })
        .returning();
      return { id: row?.id, plaintext, prefix, clientId };
    }),

  /** Update scopes của 1 key đã tồn tại. Dùng để admin sửa key cũ có
   *  scopes=[] (insecure) thành explicit scope, hoặc đổi quyền. */
  updateScopes: rbacProcedure("edit", "settings")
    .input(
      z.object({
        id: z.string().uuid(),
        scopes: z.array(z.string()).min(1, "Phải chỉ định ít nhất 1 scope"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      validateScopes(input.scopes);
      await ctx.db
        .update(apiKeys)
        .set({ scopes: input.scopes })
        .where(and(eq(apiKeys.id, input.id), eq(apiKeys.companyId, ctx.user.companyId)));
      return { ok: true };
    }),

  setEnabled: rbacProcedure("edit", "settings")
    .input(z.object({ id: z.string().uuid(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(apiKeys)
        .set({ enabled: input.enabled })
        .where(and(eq(apiKeys.id, input.id), eq(apiKeys.companyId, ctx.user.companyId)));
      return { ok: true };
    }),

  delete: rbacProcedure("edit", "settings")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(apiKeys)
        .where(and(eq(apiKeys.id, input), eq(apiKeys.companyId, ctx.user.companyId)));
    }),
});
