/* ==========================================================
   oauth.ts — OAuth 2.0 client_credentials flow trên api_keys.
   POST /oauth/token với body:
     grant_type=client_credentials
     client_id=<api_keys.client_id>
     client_secret=<plaintext sk_xxx>
   → trả { access_token, token_type, expires_in (0 = no expiry) }.
   Access token = chính sk_xxx → caller dùng làm Bearer / X-API-Key.

   Đây là wrapper standard cho api_keys hiện có; chưa implement
   refresh token, authorization code, PKCE (v5 nếu cần).
   ========================================================== */
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { apiKeys } from "@erp-framework/db";
import type { DB } from "./db";

export function registerOAuth(app: FastifyInstance, db: DB): void {
  app.post("/oauth/token", async (req, reply) => {
    // Accept form-encoded HOẶC JSON body (OAuth spec là form-urlencoded).
    const body = (req.body ?? {}) as Record<string, string>;
    const grant = body.grant_type;
    const clientId = body.client_id;
    const clientSecret = body.client_secret;
    if (grant !== "client_credentials") {
      return reply.code(400).send({
        error: "unsupported_grant_type",
        error_description: "Chỉ hỗ trợ client_credentials",
      });
    }
    if (!clientId || !clientSecret) {
      return reply.code(400).send({
        error: "invalid_request",
        error_description: "client_id và client_secret bắt buộc",
      });
    }
    // Verify: client_secret = plaintext sk_xxx → sha256 → match key_hash
    // + client_id phải khớp.
    const hash = createHash("sha256").update(clientSecret).digest("hex");
    const [row] = await db.select().from(apiKeys)
      .where(and(
        eq(apiKeys.clientId, clientId),
        eq(apiKeys.keyHash, hash),
        eq(apiKeys.enabled, true),
      ));
    if (!row) {
      return reply.code(401).send({
        error: "invalid_client",
        error_description: "client_id hoặc client_secret sai",
      });
    }
    // Best-effort update lastUsedAt.
    void db.update(apiKeys).set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, row.id));
    // Trả về OAuth 2.0 standard response. expires_in = 0 nghĩa là không
    // expire (api_keys không có TTL); caller theo chuẩn nên treat 0 là
    // long-lived bearer.
    return reply.send({
      access_token: clientSecret, // chính là sk_xxx
      token_type: "Bearer",
      expires_in: 0,
      scope: ((row.scopes ?? []) as string[]).join(" "),
    });
  });
}
