/* ==========================================================
   api-key-auth.ts — Xác thực header X-API-Key dùng chung cho mọi
   bề mặt external (REST /api/v1/*, GraphQL, MCP /mcp).
   Key plaintext "sk_<...>" → sha256 → so với api_keys.key_hash.
   Deny-by-default: scopes rỗng = không quyền gì (xem hasScope ở từng
   bề mặt). Trả về cả id để audit (vd ai_proposals.api_key_id).
   ========================================================== */
import { createHash } from "node:crypto";
import { apiKeys } from "@erp-framework/db";
import { and, eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { DB } from "./db";

export interface ApiKeyContext {
  id: string;
  companyId: string;
  scopes: string[];
}

/** Verify X-API-Key + load company + scopes. Trả null nếu invalid. */
export async function authApiKey(db: DB, req: FastifyRequest): Promise<ApiKeyContext | null> {
  const key = req.headers["x-api-key"];
  if (typeof key !== "string" || !key.startsWith("sk_")) return null;
  const hash = createHash("sha256").update(key).digest("hex");
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), eq(apiKeys.enabled, true)));
  if (!row) return null;
  // Best-effort update lastUsedAt (không await).
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch(() => {
      /* ignore */
    });
  return {
    id: row.id,
    companyId: row.companyId,
    scopes: (row.scopes ?? []) as string[],
  };
}
