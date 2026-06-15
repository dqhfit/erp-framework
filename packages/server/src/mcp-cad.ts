/* ==========================================================
   mcp-cad.ts — MCP server (JSON-RPC over HTTP) cho bản vẽ CAD.

   Provider 3 (external máy trạm): 1 PC riêng cài FreeCAD + 1 FreeCAD MCP
   off-the-shelf + Claude Code. Claude Code nối tới ĐÂY (ERP MCP) để:
     - cad:read   → cad_get_product: đọc sản phẩm + định mức gỗ ván/ngũ kim.
     - cad:write  → cad_save_drawing: nhận artifact (svg/step/png base64) →
                    persistDrawing (ghi BANVE_FILES_DIR + tr_banve "Bản vẽ AI").
   ...rồi dùng FreeCAD MCP local dựng hình. Mọi kết nối outbound từ máy trạm
   → KHÔNG dính rủi ro browser (CORS/PNA/DNS-rebinding).

   Endpoint: POST /mcp/cad   (JSON-RPC 2.0)
   Auth:     header X-API-Key (api_keys), scope cad:read|write (deny-by-default).
   Mọi truy vấn scope theo companyId của API key.
   ========================================================== */
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { type ApiKeyContext, authApiKey } from "./api-key-auth";
import { type DrawingExt, persistDrawing } from "./cad-persist";
import type { DB } from "./db";
import { getRecordStore } from "./record-store";

const SERVER_NAME = "erp-cad";
const SERVER_VERSION = "1.0.0";
const PROTOCOL_VERSION = "2024-11-05";

/* ── Scope helper (deny-by-default) ─────────────────────────── */
export function hasCadScope(scopes: string[], level: "read" | "write"): boolean {
  if (scopes.includes("*") || scopes.includes("cad:*")) return true;
  if (level === "write") return scopes.includes("cad:write");
  return scopes.includes("cad:read") || scopes.includes("cad:write");
}

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

const TOOLS: ToolDef[] = [
  {
    name: "cad_get_product",
    description:
      "Đọc 1 sản phẩm theo masp + định mức gỗ ván (tr_dinhmuc_govan) + định mức " +
      "ngũ kim (tr_dinhmuc_ngukim). Dùng để lấy kích thước/chi tiết trước khi dựng CAD.",
    level: "read",
    inputSchema: {
      type: "object",
      properties: { masp: { type: "string", description: "Mã sản phẩm." } },
      required: ["masp"],
    },
  },
  {
    name: "cad_save_drawing",
    description:
      "Lưu bản vẽ CAD đã dựng vào hồ sơ sản phẩm: bản vẽ 2D (svg/html/pdf, base64) " +
      "vào tr_banve (phanloai='Bản vẽ AI', tự set isbvai), kèm artifact phụ (model " +
      "STEP, ảnh PNG). Trả id + url xem. Cần scope cad:write.",
    level: "write",
    inputSchema: {
      type: "object",
      properties: {
        masp: { type: "string", description: "Mã sản phẩm." },
        format: {
          type: "string",
          enum: ["svg", "html", "pdf"],
          description: "Định dạng bản vẽ 2D.",
        },
        drawingBase64: { type: "string", description: "Nội dung bản vẽ 2D, base64." },
        stepBase64: { type: "string", description: "Model 3D STEP, base64 (tuỳ chọn)." },
        stlBase64: { type: "string", description: "Mesh 3D STL để xem web, base64 (tuỳ chọn)." },
        pngBase64: { type: "string", description: "Ảnh preview PNG, base64 (tuỳ chọn)." },
      },
      required: ["masp", "format", "drawingBase64"],
    },
  },
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

function asObj(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" ? (args as Record<string, unknown>) : {};
}

/** entityId theo tên (company-scoped). null nếu không có. */
async function entityIdByName(db: DB, companyId: string, name: string): Promise<string | null> {
  const r = (await db.execute(
    sql`SELECT id FROM entities WHERE company_id = ${companyId}::uuid AND lower(name) = lower(${name}) LIMIT 1`,
  )) as unknown as Array<{ id: string }>;
  return r[0]?.id ?? null;
}

/** List record theo masp (HYBRID tier-safe qua getRecordStore). */
async function listByMasp(
  db: DB,
  companyId: string,
  entityId: string,
  masp: string,
  limit = 500,
): Promise<Array<Record<string, unknown>>> {
  const out = await getRecordStore(db).list(companyId, entityId, {
    filters: { masp: { op: "=", value: masp } },
    limit,
    withTotal: false,
  });
  return out.rows.map((r) => (r.data ?? {}) as Record<string, unknown>);
}

/* ── Dispatch 1 tool → dữ liệu thuần (testable) ─────────────── */
export async function callCadTool(
  db: DB,
  ctx: ApiKeyContext,
  name: string,
  rawArgs: unknown,
): Promise<unknown> {
  const def = TOOL_MAP.get(name);
  if (!def) throw new McpError(`Tool không tồn tại: ${name}`, -32601);
  if (!hasCadScope(ctx.scopes, def.level)) {
    throw new McpError(`Thiếu scope cad:${def.level} cho tool ${name}`, -32001);
  }
  const args = asObj(rawArgs);
  const companyId = ctx.companyId;

  switch (name) {
    case "cad_get_product": {
      const masp = z.string().min(1).parse(args.masp).trim();
      const [spId, gvId, nkId] = await Promise.all([
        entityIdByName(db, companyId, "tr_sanpham"),
        entityIdByName(db, companyId, "tr_dinhmuc_govan"),
        entityIdByName(db, companyId, "tr_dinhmuc_ngukim"),
      ]);
      if (!spId) throw new McpError("Chưa có entity tr_sanpham", -32004);
      const sp = await listByMasp(db, companyId, spId, masp, 1);
      if (sp.length === 0) throw new McpError(`Sản phẩm "${masp}" không tồn tại`, -32004);
      const govan = gvId ? await listByMasp(db, companyId, gvId, masp) : [];
      const ngukim = nkId ? await listByMasp(db, companyId, nkId, masp) : [];
      return { masp, product: sp[0], govan, ngukim };
    }

    case "cad_save_drawing": {
      const masp = z.string().min(1).parse(args.masp).trim();
      const format = z.enum(["svg", "html", "pdf"]).parse(args.format) as DrawingExt;
      const drawingBase64 = z.string().min(1).parse(args.drawingBase64);
      const extras: Array<{ name: string; base64: string }> = [];
      if (typeof args.stepBase64 === "string" && args.stepBase64) {
        extras.push({ name: "model.step", base64: args.stepBase64 });
      }
      if (typeof args.stlBase64 === "string" && args.stlBase64) {
        extras.push({ name: "model.stl", base64: args.stlBase64 });
      }
      if (typeof args.pngBase64 === "string" && args.pngBase64) {
        extras.push({ name: "preview.png", base64: args.pngBase64 });
      }
      const saved = await persistDrawing(db, companyId, {
        masp,
        drawing: { ext: format, base64: drawingBase64 },
        extras,
        createdBy: ctx.createdBy ?? null,
      });
      return {
        ok: true,
        drawingId: saved.id,
        url: saved.url,
        filepath: saved.filepath,
        extras: saved.extras,
      };
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

export function registerCadMcp(app: FastifyInstance, db: DB): void {
  app.post("/mcp/cad", async (req, reply) => {
    const auth = await authApiKey(db, req);
    if (!auth) return reply.code(401).send({ error: "Invalid API key" });
    if (!hasCadScope(auth.scopes, "read")) {
      return reply.code(403).send({ error: "Thiếu scope cad:read|write" });
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
          const data = await callCadTool(db, auth, name, p.arguments);
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
      console.error("[mcp/cad] lỗi:", e);
      return fail(-32603, (e as Error).message || "Lỗi nội bộ");
    }
  });
}
