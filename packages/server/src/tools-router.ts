/* ==========================================================
   tools-router.ts — tRPC API cho hệ Tool ngoài monorepo.
   - list / get / getStatus / getProxyUrl  : đọc
   - rescan / registerRemote               : admin discovery
   - enableForCompany / spawn / stop       : admin lifecycle
   - invokeAction                          : kind-aware dispatch
   ========================================================== */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { tools as toolsTable, companyTools } from "@erp-framework/db";
import { toolRegistry, type ToolManifest } from "@erp-framework/core";
import { router, rbacProcedure } from "./trpc";
import {
  scanTools, registerRemoteTool, startTool, stopTool, getRunningPort,
  invokeCli,
} from "./tools";
import { makeCallTool } from "./mcp-client";
import { logActivity } from "./activity";

const DEFAULT_TOOLS_DIR = process.platform === "win32"
  ? "D:\\code\\cowok\\Tools"
  : "/code/cowok/Tools";

function toolsDir(): string {
  return process.env.TOOLS_DIR ?? DEFAULT_TOOLS_DIR;
}

/** Có phải private/loopback IP không (chặn SSRF). */
function isPrivateHost(host: string): boolean {
  if (host === "localhost") return true;
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

async function getEnabledMap(
  db: import("./db").DB, companyId: string,
): Promise<Map<string, { enabled: boolean; config: Record<string, unknown> }>> {
  const rows = await db.select().from(companyTools)
    .where(eq(companyTools.companyId, companyId));
  const map = new Map<string, { enabled: boolean; config: Record<string, unknown> }>();
  for (const r of rows) {
    map.set(r.toolId, {
      enabled: r.enabled,
      config: (r.config ?? {}) as Record<string, unknown>,
    });
  }
  return map;
}

export const toolsRouter = router({
  list: rbacProcedure("view", "settings")
    .query(async ({ ctx }) => {
      const rows = await ctx.db.select().from(toolsTable)
        .orderBy(desc(toolsTable.createdAt));
      const enabled = await getEnabledMap(ctx.db, ctx.user.companyId);
      return rows.map((r) => {
        const reg = toolRegistry.getById(r.slug);
        return {
          id: r.id,
          slug: r.slug,
          name: r.name,
          displayName: r.displayName,
          kind: r.kind,
          runtime: r.runtime,
          manifest: r.manifest as ToolManifest,
          source: r.source,
          enabledGlobal: r.enabledGlobal,
          enabledForCompany: enabled.get(r.id)?.enabled ?? false,
          status: reg?.status ?? "discovered",
          runtimeMeta: reg?.runtimeMeta,
          updatedAt: r.updatedAt,
        };
      });
    }),

  get: rbacProcedure("view", "settings")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db.select().from(toolsTable)
        .where(eq(toolsTable.id, input));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Tool không tồn tại" });
      const reg = toolRegistry.getById(row.slug);
      return {
        ...row,
        status: reg?.status ?? "discovered",
        runtimeMeta: reg?.runtimeMeta,
      };
    }),

  getStatus: rbacProcedure("view", "settings")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db.select({ slug: toolsTable.slug })
        .from(toolsTable).where(eq(toolsTable.id, input));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      const reg = toolRegistry.getById(row.slug);
      return {
        status: reg?.status ?? "discovered",
        runtimeMeta: reg?.runtimeMeta,
        error: reg?.error,
      };
    }),

  /** Trả URL nhúng iframe — luôn cùng-origin với ERP (qua proxy). */
  getProxyUrl: rbacProcedure("view", "settings")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db.select().from(toolsTable)
        .where(eq(toolsTable.id, input));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      const m = row.manifest as ToolManifest;
      const mountPath = m.proxy?.mountPath ?? `/tools/${row.slug}`;
      return { url: mountPath };
    }),

  rescan: rbacProcedure("edit", "settings")
    .mutation(async ({ ctx }) => {
      const res = await scanTools(ctx.db, { toolsDir: toolsDir() });
      await logActivity(ctx.db, {
        companyId: ctx.user.companyId,
        kind: "tool.rescan",
        detail: `added=${res.added.length} updated=${res.updated.length} errors=${res.errors.length}`,
        actorUserId: ctx.user.id,
      });
      return res;
    }),

  registerRemote: rbacProcedure("edit", "settings")
    .input(z.object({ manifestUrl: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      const url = new URL(input.manifestUrl);
      const allowPrivate = process.env.TOOLS_ALLOW_PRIVATE_REMOTE === "1";
      if (!allowPrivate && isPrivateHost(url.hostname)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Không cho phép URL private/loopback (set TOOLS_ALLOW_PRIVATE_REMOTE=1 để bỏ qua)",
        });
      }
      const r = await fetch(input.manifestUrl, {
        signal: AbortSignal.timeout(10_000),
        headers: { accept: "application/json" },
      });
      if (!r.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Tải manifest fail: ${r.status} ${r.statusText}`,
        });
      }
      const len = Number(r.headers.get("content-length") ?? 0);
      if (len > 256 * 1024) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Manifest > 256KB" });
      }
      const json = await r.json();
      const manifest = await registerRemoteTool(ctx.db, input.manifestUrl, json);
      await logActivity(ctx.db, {
        companyId: ctx.user.companyId,
        kind: "tool.register-remote",
        target: manifest.id,
        detail: input.manifestUrl,
        actorUserId: ctx.user.id,
      });
      return { id: manifest.id, kind: manifest.kind, runtime: manifest.runtime };
    }),

  enableForCompany: rbacProcedure("edit", "settings")
    .input(z.object({
      toolId: z.string().uuid(),
      enabled: z.boolean(),
      config: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db.select({ id: companyTools.id })
        .from(companyTools).where(and(
          eq(companyTools.companyId, ctx.user.companyId),
          eq(companyTools.toolId, input.toolId)));
      if (existing) {
        await ctx.db.update(companyTools).set({
          enabled: input.enabled,
          ...(input.config !== undefined ? { config: input.config } : {}),
          updatedAt: new Date(),
        }).where(eq(companyTools.id, existing.id));
      } else {
        await ctx.db.insert(companyTools).values({
          companyId: ctx.user.companyId,
          toolId: input.toolId,
          enabled: input.enabled,
          config: input.config ?? {},
        });
      }
      await logActivity(ctx.db, {
        companyId: ctx.user.companyId,
        kind: input.enabled ? "tool.enable" : "tool.disable",
        target: input.toolId,
        detail: "",
        actorUserId: ctx.user.id,
      });
      return { ok: true };
    }),

  spawn: rbacProcedure("edit", "settings")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db.select().from(toolsTable)
        .where(eq(toolsTable.id, input));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      const manifest = row.manifest as ToolManifest;
      if (manifest.runtime !== "spawn") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Runtime "${manifest.runtime}" không hỗ trợ spawn`,
        });
      }
      const meta = await startTool(manifest);
      return { ok: true, ...meta };
    }),

  stop: rbacProcedure("edit", "settings")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db.select({ slug: toolsTable.slug })
        .from(toolsTable).where(eq(toolsTable.id, input));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      const ok = stopTool(row.slug);
      return { ok };
    }),

  /** Invoke 1 action — dispatch theo manifest.kind. */
  invokeAction: rbacProcedure("run", "agent")
    .input(z.object({
      toolId: z.string().uuid(),
      action: z.string().min(1),
      args: z.record(z.string(), z.unknown()).default({}),
    }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db.select().from(toolsTable)
        .where(eq(toolsTable.id, input.toolId));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      const manifest = row.manifest as ToolManifest;
      switch (manifest.kind) {
        case "cli": {
          const res = await invokeCli(manifest, input.action, input.args);
          return res;
        }
        case "mcp-server": {
          const callTool = makeCallTool(ctx.db, ctx.user.companyId);
          const result = await callTool(input.action, input.args);
          return { ok: true, result };
        }
        case "web-app": {
          const port = getRunningPort(manifest.id);
          const base = manifest.runtime === "spawn"
            ? (port ? `http://127.0.0.1:${port}` : undefined)
            : manifest.remoteUrl;
          if (!base) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Tool chưa sẵn sàng — hãy spawn trước",
            });
          }
          const r = await fetch(`${base}/actions/${encodeURIComponent(input.action)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input.args),
          });
          const text = await r.text();
          let body: unknown = text;
          try { body = JSON.parse(text); } catch { /* plain text */ }
          return { ok: r.ok, status: r.status, body };
        }
        case "plugin":
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Plugin tool gọi qua pluginRegistry, không qua invokeAction",
          });
      }
    }),
});
