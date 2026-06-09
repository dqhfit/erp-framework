/* ==========================================================
   oauth.ts — OAuth 2.0 endpoints trên api_keys.
   3 grant types:
     - client_credentials: machine-to-machine, trả access (sk_xxx) +
       refresh token mới.
     - authorization_code: + PKCE bắt buộc (S256). User flow.
     - refresh_token: rotate refresh + cấp access mới.
   PKCE: code_challenge = SHA256(verifier) base64url-encoded.
   ========================================================== */
import type { FastifyInstance } from "fastify";
import "@fastify/cookie"; // augmentation req.cookies
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import {
  apiKeys,
  companyMembers,
  oauthAuthCodes,
  oauthRefreshTokens,
  sessions,
} from "@erp-framework/db";
import { SESSION_COOKIE } from "./auth";
import type { DB } from "./db";

const REFRESH_TOKEN_TTL_DAYS = 30;
const AUTH_CODE_TTL_MIN = 10;

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
function genRefreshToken(): { plaintext: string; hash: string } {
  const plaintext = `rt_${randomBytes(32).toString("hex")}`;
  return { plaintext, hash: sha256(plaintext) };
}
function genAuthCode(): { plaintext: string; hash: string } {
  const plaintext = randomBytes(32).toString("base64url");
  return { plaintext, hash: sha256(plaintext) };
}
/** Verify PKCE: base64url(SHA256(verifier)) === code_challenge. */
function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method !== "S256") return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  return computed === challenge;
}

export function registerOAuth(app: FastifyInstance, db: DB): void {
  app.post("/oauth/token", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const grant = body.grant_type;
    const clientId = body.client_id;
    const clientSecret = body.client_secret;

    if (grant === "client_credentials") {
      // M2M flow.
      if (!clientId || !clientSecret) {
        return reply.code(400).send({
          error: "invalid_request",
          error_description: "client_id và client_secret bắt buộc",
        });
      }
      const [row] = await db
        .select()
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.clientId, clientId),
            eq(apiKeys.keyHash, sha256(clientSecret)),
            eq(apiKeys.enabled, true),
          ),
        );
      if (!row) {
        return reply.code(401).send({
          error: "invalid_client",
          error_description: "client_id hoặc client_secret sai",
        });
      }
      void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
      const rt = genRefreshToken();
      await db.insert(oauthRefreshTokens).values({
        companyId: row.companyId,
        apiKeyId: row.id,
        tokenHash: rt.hash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86400_000),
      });
      return reply.send({
        access_token: clientSecret,
        token_type: "Bearer",
        expires_in: 0,
        refresh_token: rt.plaintext,
        scope: ((row.scopes ?? []) as string[]).join(" "),
      });
    }

    if (grant === "authorization_code") {
      // PKCE + auth code flow.
      const code = body.code;
      const verifier = body.code_verifier;
      const redirectUri = body.redirect_uri;
      if (!code || !verifier || !clientId || !redirectUri) {
        return reply.code(400).send({
          error: "invalid_request",
          error_description: "code, code_verifier, client_id, redirect_uri bắt buộc",
        });
      }
      const [ac] = await db
        .select()
        .from(oauthAuthCodes)
        .where(
          and(
            eq(oauthAuthCodes.codeHash, sha256(code)),
            eq(oauthAuthCodes.clientId, clientId),
            eq(oauthAuthCodes.redirectUri, redirectUri),
            isNull(oauthAuthCodes.usedAt),
            sql`${oauthAuthCodes.expiresAt} > now()`,
          ),
        );
      if (!ac) {
        return reply.code(400).send({
          error: "invalid_grant",
          error_description: "code không hợp lệ, đã dùng, hoặc hết hạn",
        });
      }
      if (!verifyPkce(verifier, ac.codeChallenge, ac.codeChallengeMethod)) {
        return reply.code(400).send({
          error: "invalid_grant",
          error_description: "PKCE verifier không khớp challenge",
        });
      }
      await db
        .update(oauthAuthCodes)
        .set({ usedAt: new Date() })
        .where(eq(oauthAuthCodes.id, ac.id));
      const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, ac.apiKeyId));
      if (!key) return reply.code(500).send({ error: "server_error" });
      const rt = genRefreshToken();
      await db.insert(oauthRefreshTokens).values({
        companyId: ac.companyId,
        apiKeyId: ac.apiKeyId,
        tokenHash: rt.hash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86400_000),
      });
      return reply.send({
        access_token: "<see api-keys panel>",
        token_type: "Bearer",
        expires_in: 0,
        refresh_token: rt.plaintext,
        scope: ((key.scopes ?? []) as string[]).join(" "),
      });
    }

    if (grant === "refresh_token") {
      // Refresh rotation.
      const refresh = body.refresh_token;
      if (!refresh) {
        return reply.code(400).send({
          error: "invalid_request",
          error_description: "refresh_token bắt buộc",
        });
      }
      const [rt] = await db
        .select()
        .from(oauthRefreshTokens)
        .where(
          and(
            eq(oauthRefreshTokens.tokenHash, sha256(refresh)),
            isNull(oauthRefreshTokens.revokedAt),
            sql`${oauthRefreshTokens.expiresAt} > now()`,
          ),
        );
      if (!rt) {
        return reply.code(400).send({
          error: "invalid_grant",
          error_description: "refresh_token không hợp lệ hoặc hết hạn",
        });
      }
      await db
        .update(oauthRefreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(oauthRefreshTokens.id, rt.id));
      const newRt = genRefreshToken();
      await db.insert(oauthRefreshTokens).values({
        companyId: rt.companyId,
        apiKeyId: rt.apiKeyId,
        tokenHash: newRt.hash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86400_000),
      });
      const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, rt.apiKeyId));
      return reply.send({
        access_token: "<see api-keys panel>",
        token_type: "Bearer",
        expires_in: 0,
        refresh_token: newRt.plaintext,
        scope: ((key?.scopes ?? []) as string[]).join(" "),
      });
    }

    return reply.code(400).send({
      error: "unsupported_grant_type",
      error_description: `Grant "${grant}" — dùng client_credentials | authorization_code | refresh_token`,
    });
  });

  /** Authorization endpoint — issue PKCE auth code. v1 trả JSON code
   *  (production cần render UI consent + redirect). */
  app.get("/oauth/authorize", async (req, reply) => {
    const q = req.query as Record<string, string>;
    const clientId = q.client_id;
    const redirectUri = q.redirect_uri;
    const codeChallenge = q.code_challenge;
    const codeChallengeMethod = q.code_challenge_method ?? "S256";
    if (q.response_type !== "code") {
      return reply.code(400).send({ error: "unsupported_response_type" });
    }
    if (!clientId || !redirectUri || !codeChallenge) {
      return reply.code(400).send({
        error: "invalid_request",
        error_description: "client_id, redirect_uri, code_challenge bắt buộc",
      });
    }
    const [key] = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.clientId, clientId), eq(apiKeys.enabled, true)));
    if (!key) return reply.code(400).send({ error: "invalid_client" });

    // BẢO VỆ: phải là người dùng ĐÃ ĐĂNG NHẬP và là thành viên công ty của
    // client. Trước đây chỉ cần biết client_id (công khai) → ai cũng mint được
    // auth code. Giờ phải có phiên hợp lệ + thuộc đúng công ty.
    const sid = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (!sid) {
      return reply.code(401).send({
        error: "login_required",
        error_description: "Cần đăng nhập trước khi cấp quyền.",
      });
    }
    const [sess] = await db
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(and(eq(sessions.id, sid), gt(sessions.expiresAt, new Date())));
    if (!sess) {
      return reply.code(401).send({
        error: "login_required",
        error_description: "Phiên không hợp lệ hoặc hết hạn.",
      });
    }
    const [mem] = await db
      .select({ id: companyMembers.id })
      .from(companyMembers)
      .where(
        and(eq(companyMembers.userId, sess.userId), eq(companyMembers.companyId, key.companyId)),
      );
    if (!mem) {
      return reply.code(403).send({
        error: "access_denied",
        error_description: "Bạn không thuộc công ty của client này.",
      });
    }
    // redirect_uri phải hợp lệ; nếu set OAUTH_REDIRECT_ALLOWLIST thì origin phải khớp.
    let parsedRedirect: URL;
    try {
      parsedRedirect = new URL(redirectUri);
    } catch {
      return reply.code(400).send({
        error: "invalid_request",
        error_description: "redirect_uri không hợp lệ.",
      });
    }
    const redirectAllow = (process.env.OAUTH_REDIRECT_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (redirectAllow.length && !redirectAllow.includes(parsedRedirect.origin)) {
      return reply.code(400).send({
        error: "invalid_request",
        error_description: "redirect_uri không nằm trong allowlist.",
      });
    }

    const { plaintext, hash } = genAuthCode();
    await db.insert(oauthAuthCodes).values({
      codeHash: hash,
      clientId,
      companyId: key.companyId,
      apiKeyId: key.id,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MIN * 60_000),
    });
    return reply.send({ code: plaintext, redirect_uri: redirectUri });
  });
}
