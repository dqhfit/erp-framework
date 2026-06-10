/* ==========================================================
   mcp-errors.ts — MCP server (JSON-RPC over HTTP) cho module Lỗi client.

   Mục tiêu: cho AI bên ngoài (vd Claude) KẾT NỐI để ĐỌC lỗi runtime mà
   app gửi về (error-router.ts), rồi ĐỔI TRẠNG THÁI (resolved/ignored/open)
   hoặc XOÁ lỗi. Khác MCP Phản hồi (chỉ đề xuất pending), ở đây AI được
   mutate trực tiếp — nhưng phải có scope errors:write (deny-by-default).

   Endpoint: POST /mcp/errors   (JSON-RPC 2.0)
   Auth:     header X-API-Key (api_keys), scope:
     - errors:read   → tool đọc (list/get/stats)
     - errors:write  → tool đổi trạng thái / xoá (kèm quyền đọc)
     - "errors:*" / "*" → toàn quyền errors
   Deny-by-default: scope rỗng = không gì. Mọi truy vấn scope companyId.

   Methods: initialize, tools/list, tools/call, ping.
   ========================================================== */
import { clientErrors } from "@erp-framework/db";
import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { type ApiKeyContext, authApiKey } from "./api-key-auth";
import type { DB } from "./db";

const SERVER_NAME = "erp-errors";
const SERVER_VERSION = "1.0.0";
const PROTOCOL_VERSION = "2024-11-05";

/* ── Scope helper ───────────────────────────────────────────── */
export function hasErrorScope(scopes: string[], level: "read" | "write"): boolean {
  if (scopes.includes("*") || scopes.includes("errors:*")) return true;
  if (level === "write") return scopes.includes("errors:write");
  // read = mọi scope ghi đều đọc được (write ⊇ read).
  return scopes.includes("errors:read") || scopes.includes("errors:write");
}

/* ── Lỗi tool có mã JSON-RPC ────────────────────────────────── */
class McpError extends Error {
  code: number;
  constructor(message: string, code = -32602) {
    super(message);
    this.code = code;
  }
}

interface ToolDef {
  name: string;
  description: string;
  level: "read" | "write";
  inputSchema: Record<string, unknown>;
}

const STATUS_ENUM = ["open", "resolved", "ignored"];
const LEVEL_ENUM = ["error", "warn"];

const TOOLS: ToolDef[] = [
  {
    name: "error_list",
    description:
      "Liệt kê lỗi client của công ty (mới nhất trước). Lọc status (open|resolved|ignored), level (error|warn), q (khớp message). Trả id, level, source, message, url, status, count, firstSeenAt, lastSeenAt.",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: STATUS_ENUM },
        level: { type: "string", enum: LEVEL_ENUM },
        q: { type: "string", description: "Khớp 1 phần message" },
        limit: { type: "number", minimum: 1, maximum: 500 },
      },
    },
  },
  {
    name: "error_get",
    description: "Lấy chi tiết 1 lỗi (kèm stack, componentStack, userAgent, meta).",
    level: "read",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "UUID lỗi" } },
      required: ["id"],
    },
  },
  {
    name: "error_stats",
    description:
      "Đếm lỗi theo trạng thái (open/resolved/ignored) + tổng — dùng để biết còn bao nhiêu lỗi cần xử lý.",
    level: "read",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "error_set_status",
    description:
      "Đổi trạng thái 1 nhóm lỗi: resolved khi đã fix, ignored khi bỏ qua, open để mở lại. Cần scope errors:write. Trả số mục đã đổi.",
    level: "write",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "1-500 UUID lỗi." },
        status: { type: "string", enum: STATUS_ENUM },
      },
      required: ["ids", "status"],
    },
  },
  {
    name: "error_delete",
    description:
      "XOÁ HẲN 1 nhóm lỗi (không khôi phục được). Cần scope errors:write. Trả số mục đã xoá.",
    level: "write",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "1-500 UUID lỗi." },
      },
      required: ["ids"],
    },
  },
  {
    name: "error_clear_resolved",
    description:
      "Xoá hẳn TẤT CẢ lỗi đang ở trạng thái resolved — dọn nhanh. Cần scope errors:write.",
    level: "write",
    inputSchema: { type: "object", properties: {} },
  },
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

function asObj(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" ? (args as Record<string, unknown>) : {};
}

/* ── Dispatch 1 tool → dữ liệu thuần (testable) ─────────────── */
export async function callErrorTool(
  db: DB,
  ctx: ApiKeyContext,
  name: string,
  rawArgs: unknown,
): Promise<unknown> {
  const def = TOOL_MAP.get(name);
  if (!def) throw new McpError(`Tool không tồn tại: ${name}`, -32601);
  if (!hasErrorScope(ctx.scopes, def.level)) {
    throw new McpError(`Thiếu scope errors:${def.level} cho tool ${name}`, -32001);
  }
  const args = asObj(rawArgs);
  const companyId = ctx.companyId;

  switch (name) {
    case "error_list": {
      const status = args.status as string | undefined;
      const level = args.level as string | undefined;
      const q = typeof args.q === "string" ? args.q.trim() : "";
      const limit = Math.min(Number(args.limit ?? 100) || 100, 500);
      const conds = [eq(clientErrors.companyId, companyId)];
      if (status) conds.push(eq(clientErrors.status, status));
      if (level) conds.push(eq(clientErrors.level, level));
      if (q) conds.push(ilike(clientErrors.message, `%${q}%`));
      const rows = await db
        .select({
          id: clientErrors.id,
          level: clientErrors.level,
          source: clientErrors.source,
          message: clientErrors.message,
          url: clientErrors.url,
          status: clientErrors.status,
          count: clientErrors.count,
          firstSeenAt: clientErrors.firstSeenAt,
          lastSeenAt: clientErrors.lastSeenAt,
        })
        .from(clientErrors)
        .where(and(...conds))
        .orderBy(desc(clientErrors.lastSeenAt))
        .limit(limit);
      return { count: rows.length, items: rows };
    }

    case "error_get": {
      const id = z.string().uuid().parse(args.id);
      const [row] = await db
        .select()
        .from(clientErrors)
        .where(and(eq(clientErrors.id, id), eq(clientErrors.companyId, companyId)));
      if (!row) throw new McpError("Lỗi không tồn tại", -32004);
      return row;
    }

    case "error_stats": {
      const rows = await db
        .select({ status: clientErrors.status, n: sql<number>`count(*)::int` })
        .from(clientErrors)
        .where(eq(clientErrors.companyId, companyId))
        .groupBy(clientErrors.status);
      const out = { open: 0, resolved: 0, ignored: 0, total: 0 };
      for (const r of rows) {
        const n = Number(r.n) || 0;
        if (r.status === "open") out.open = n;
        else if (r.status === "resolved") out.resolved = n;
        else if (r.status === "ignored") out.ignored = n;
        out.total += n;
      }
      return out;
    }

    case "error_set_status": {
      const status = z.enum(["open", "resolved", "ignored"]).parse(args.status);
      const ids = z.array(z.string().uuid()).min(1).max(500).parse(args.ids);
      const res = await db
        .update(clientErrors)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(clientErrors.companyId, companyId), inArray(clientErrors.id, ids)))
        .returning({ id: clientErrors.id });
      return {
        updated: res.length,
        status,
        message: `Đã đổi ${res.length} lỗi sang "${status}".`,
      };
    }

    case "error_delete": {
      const ids = z.array(z.string().uuid()).min(1).max(500).parse(args.ids);
      const res = await db
        .delete(clientErrors)
        .where(and(eq(clientErrors.companyId, companyId), inArray(clientErrors.id, ids)))
        .returning({ id: clientErrors.id });
      return { deleted: res.length, message: `Đã xoá ${res.length} lỗi.` };
    }

    case "error_clear_resolved": {
      const res = await db
        .delete(clientErrors)
        .where(and(eq(clientErrors.companyId, companyId), eq(clientErrors.status, "resolved")))
        .returning({ id: clientErrors.id });
      return { deleted: res.length, message: `Đã xoá ${res.length} lỗi đã xử lý.` };
    }

    default:
      throw new McpError(`Tool chưa cài đặt: ${name}`, -32601);
  }
}

/* ── JSON-RPC handler ───────────────────────────────────────── */
interface JsonRpcReq {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

export function registerErrorsMcp(app: FastifyInstance, db: DB): void {
  app.post("/mcp/errors", async (req, reply) => {
    const auth = await authApiKey(db, req);
    if (!auth) return reply.code(401).send({ error: "Invalid API key" });
    if (!hasErrorScope(auth.scopes, "read")) {
      return reply.code(403).send({ error: "Thiếu scope errors:read|write" });
    }

    const body = (req.body ?? {}) as JsonRpcReq;
    const id = body.id ?? null;
    const method = body.method;

    const ok = (result: unknown) => reply.send({ jsonrpc: "2.0", id, result });
    const fail = (code: number, message: string) =>
      reply.send({ jsonrpc: "2.0", id, error: { code, message } });

    try {
      switch (method) {
        case "initialize":
          return ok({
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          });
        case "notifications/initialized":
          return reply.code(204).send();
        case "ping":
          return ok({});
        case "tools/list":
          return ok({
            tools: TOOLS.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          });
        case "tools/call": {
          const p = asObj(body.params);
          const name = String(p.name ?? "");
          const data = await callErrorTool(db, auth, name, p.arguments);
          return ok({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
        }
        default:
          return fail(-32601, `Method không hỗ trợ: ${method ?? "?"}`);
      }
    } catch (e) {
      if (e instanceof McpError) return fail(e.code, e.message);
      if (e instanceof z.ZodError) {
        return fail(-32602, `Tham số sai: ${e.issues.map((i) => i.message).join("; ")}`);
      }
      console.error("[mcp/errors] lỗi:", e);
      return fail(-32603, (e as Error).message || "Lỗi nội bộ");
    }
  });
}
