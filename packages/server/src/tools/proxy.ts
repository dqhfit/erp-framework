/* ==========================================================
   proxy.ts — Đăng ký Fastify HTTP proxy cho tool web-app
   (runtime=embedded|remote|spawn). Mount tại /tools/<slug>/*
   chuyển tiếp tới upstream URL của tool. Inject HMAC-signed
   header X-ERP-* khi proxy.forwardAuth=true.
   ========================================================== */
import { createHmac } from "node:crypto";
import { type ToolManifest, toolRegistry } from "@erp-framework/core";
import { companyTools, sessions, tools as toolsTable } from "@erp-framework/db";
import httpProxy from "@fastify/http-proxy";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { SESSION_COOKIE } from "../auth";
import { resolveActiveCompany } from "../context";
import type { DB } from "../db";
import { getRunningPort } from "./subprocess";

/** Secret HMAC cho X-ERP-* — bật bằng env TOOL_SIGNING_SECRET.
 *  Khi thiếu, dùng giá trị dev (vẫn hoạt động nhưng không an toàn). */
const SIGNING_SECRET = process.env.TOOL_SIGNING_SECRET ?? "dev-only-tool-secret-change-me";

function signHeaders(values: string[]): string {
  return createHmac("sha256", SIGNING_SECRET).update(values.join("|")).digest("hex");
}

function resolveUpstream(manifest: ToolManifest): string | undefined {
  if (manifest.runtime === "remote" || manifest.runtime === "embedded") {
    return manifest.remoteUrl;
  }
  if (manifest.runtime === "spawn") {
    const port = getRunningPort(manifest.id);
    if (!port) return undefined;
    return `http://127.0.0.1:${port}`;
  }
  return undefined;
}

/** Gắn route động cho 1 tool — nếu chưa có upstream (vd spawn chưa start),
 *  endpoint vẫn trả 503 thay vì 404 để UI biết chờ. */
async function registerOne(app: FastifyInstance, db: DB, manifest: ToolManifest) {
  const mountPath = manifest.proxy?.mountPath ?? `/tools/${manifest.id}`;
  const forwardAuth = manifest.proxy?.forwardAuth ?? true;

  await app.register(httpProxy, {
    upstream: "http://placeholder.invalid", // override mỗi request
    prefix: mountPath,
    rewritePrefix: "",
    replyOptions: {
      // upstream động — tính theo từng request để hỗ trợ spawn restart.
      getUpstream: (): string => resolveUpstream(manifest) ?? "http://placeholder.invalid",
      onResponse: (_req, reply, res) => {
        // Cho phép nhúng iframe từ cùng-origin của ERP.
        reply.removeHeader("x-frame-options");
        reply.removeHeader("content-security-policy");
        reply.send(res);
      },
    },
    async preHandler(req, reply) {
      const u = resolveUpstream(manifest);
      if (!u) {
        reply.code(503).send({
          error: "Tool chưa sẵn sàng",
          toolId: manifest.id,
          runtime: manifest.runtime,
        });
        return;
      }
      // Strip X-ERP-* đến từ client để chống spoof.
      for (const k of Object.keys(req.headers)) {
        if (k.toLowerCase().startsWith("x-erp-")) delete req.headers[k];
      }
      // P4.2 — Tool company-isolation. Pre-flight check user phải đăng
      // nhập + company hiện tại đã enable tool. Auth-anonymous tool
      // (forwardAuth=false) bypass — vd tool public/static.
      if (forwardAuth) {
        const ctx = await readSessionCtx(db, req);
        if (!ctx) {
          reply.code(401).send({ error: "Cần đăng nhập để dùng tool" });
          return;
        }
        const enabled = await isToolEnabledForCompany(db, manifest.id, ctx.companyId);
        if (!enabled) {
          reply.code(403).send({
            error: "Tool chưa được kích hoạt cho công ty này",
            toolId: manifest.id,
          });
          return;
        }
        req.headers["x-erp-user-id"] = ctx.userId;
        req.headers["x-erp-company-id"] = ctx.companyId;
        req.headers["x-erp-role"] = ctx.role;
        req.headers["x-erp-sig"] = signHeaders([ctx.userId, ctx.companyId, ctx.role]);
      }
    },
  });
}

/** Tool có được enable cho company không. Trả false nếu chưa hydrate
 *  (manifest.id không match row trong DB) — fail-closed. */
async function isToolEnabledForCompany(
  db: DB,
  manifestToolId: string,
  companyId: string,
): Promise<boolean> {
  // manifestToolId là tool.slug (text) — lookup row trong tools để lấy uuid.
  const [t] = await db
    .select({ id: toolsTable.id, enabledGlobal: toolsTable.enabledGlobal })
    .from(toolsTable)
    .where(eq(toolsTable.slug, manifestToolId));
  if (!t) return false;
  if (!t.enabledGlobal) return false;
  const [ct] = await db
    .select({ enabled: companyTools.enabled })
    .from(companyTools)
    .where(and(eq(companyTools.toolId, t.id), eq(companyTools.companyId, companyId)));
  return ct?.enabled === true;
}

async function readSessionCtx(
  db: DB,
  req: FastifyRequest,
): Promise<{ userId: string; companyId: string; role: string } | undefined> {
  const sid = (req.cookies as Record<string, string | undefined>)?.[SESSION_COOKIE];
  if (!sid) return undefined;
  const [s] = await db.select().from(sessions).where(eq(sessions.id, sid));
  if (!s || s.expiresAt < new Date()) return undefined;
  const active = await resolveActiveCompany(db, s.userId, s.activeCompanyId);
  if (!active) return undefined;
  return { userId: s.userId, companyId: active.companyId, role: active.role };
}

/** Đăng ký proxy cho tất cả tool đang trong registry (gọi sau hydrate+scan). */
export async function initToolsProxy(app: FastifyInstance, db: DB): Promise<void> {
  for (const t of toolRegistry.list()) {
    if (t.manifest.kind !== "web-app" && t.manifest.kind !== "mcp-server") continue;
    try {
      await registerOne(app, db, t.manifest);
      toolRegistry.setStatus(t.id, "mounted", {
        mountPath: t.manifest.proxy?.mountPath ?? `/tools/${t.id}`,
      });
    } catch (e) {
      console.error(`[tools/proxy] ${t.id}: ${(e as Error).message}`);
      toolRegistry.setStatus(t.id, "error", undefined, (e as Error).message);
    }
  }
}
