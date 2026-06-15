/* ==========================================================
   cad-tool.ts — Provider 1: tool built-in cho in-app Agent sinh bản vẽ CAD.

   Agent gọi `cad_generate` → tool gọi FreeCAD sidecar (HTTP JSON-RPC,
   FREECAD_MCP_URL) dựng 3D + bản vẽ 2D, rồi `persistDrawing` lưu file +
   chèn tr_banve (phanloai="Bản vẽ AI"). Kết quả hiện ngay ở /banve.

   Gate (fail-closed): RBAC create:entity + agent tool allowlist (index.ts)
   + chỉ bật khi FREECAD_MCP_URL được cấu hình. KHÔNG cho agent truyền
   script tự do (chỉ tham số parametric) — chống RCE.
   ========================================================== */
import { sql } from "drizzle-orm";
import type { ToolDef } from "./agent-chat";
import { type DrawingExt, persistDrawing } from "./cad-persist";
import type { DB } from "./db";

/** Tool định nghĩa cho LLM. */
export const CAD_GENERATE_TOOL: ToolDef = {
  name: "cad_generate",
  description:
    "Sinh bản vẽ CAD cho MỘT sản phẩm nội thất gỗ ván (thùng/tủ chữ nhật) " +
    "qua FreeCAD: dựng 3D + bản vẽ kỹ thuật 2D, rồi lưu vào hồ sơ bản vẽ của " +
    "sản phẩm (xuất hiện ở tab 'Bản vẽ AI'). Truyền mã sản phẩm + kích thước " +
    "W×D×H (mm) + độ dày ván.",
  schema: {
    type: "object",
    properties: {
      masp: { type: "string", description: "Mã sản phẩm (masp) cần vẽ." },
      params: {
        type: "object",
        description: "Tham số dựng hình (mm).",
        properties: {
          W: { type: "number", description: "Chiều rộng (mm)." },
          D: { type: "number", description: "Chiều sâu (mm)." },
          H: { type: "number", description: "Chiều cao (mm)." },
          thickness: { type: "number", description: "Độ dày ván (mm, mặc định 18)." },
          hasBack: { type: "boolean", description: "Có tấm hậu hay không." },
          shelves: { type: "integer", description: "Số ngăn (kệ) bên trong." },
        },
        required: ["W", "D", "H"],
      },
      format: {
        type: "string",
        enum: ["svg", "html", "pdf"],
        description: "Định dạng bản vẽ 2D (mặc định svg).",
      },
    },
    required: ["masp", "params"],
  },
};

interface FreecadPayload {
  format?: string;
  svg?: string;
  html?: string;
  pdf?: string;
  step?: string;
  stl?: string;
  png?: string;
}

/** Gọi 1 tool trên FreeCAD MCP sidecar qua JSON-RPC (HTTP). */
async function callFreecadTool(
  url: string,
  name: string,
  args: Record<string, unknown>,
  timeoutMs = 120_000,
): Promise<FreecadPayload> {
  const secret = process.env.FREECAD_MCP_SECRET;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        ...(secret ? { "x-freecad-secret": secret } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    if (!res.ok) {
      throw new Error(`Engine CAD lỗi HTTP ${res.status}: ${await res.text().catch(() => "")}`);
    }
    const j = (await res.json()) as {
      result?: { content?: Array<{ type: string; text?: string }> };
      error?: { message?: string };
    };
    if (j.error) throw new Error(`Engine CAD: ${j.error.message ?? "lỗi không rõ"}`);
    const text = j.result?.content?.[0]?.text;
    if (!text) throw new Error("Engine CAD trả về rỗng.");
    return JSON.parse(text) as FreecadPayload;
  } finally {
    clearTimeout(timer);
  }
}

export interface RunCadGenerateArgs {
  masp: string;
  params?: Record<string, unknown>;
  family?: string;
  format?: DrawingExt;
  createdBy?: string | null;
}

/**
 * Thực thi cad_generate: verify sản phẩm → gọi sidecar → persistDrawing.
 * Ném lỗi gọn (caller ở /agent/chat bắt và phát tool_result error → fail-safe).
 */
export async function runCadGenerate(
  db: DB,
  companyId: string,
  args: RunCadGenerateArgs,
): Promise<{
  ok: true;
  drawingId: string;
  drawingUrl: string;
  format: DrawingExt;
  filepath: string;
  extras: Array<{ name: string; filepath: string }>;
}> {
  const url = process.env.FREECAD_MCP_URL;
  if (!url) throw new Error("FREECAD_MCP_URL chưa cấu hình — chưa bật engine CAD.");
  const masp = String(args.masp ?? "").trim();
  if (!masp) throw new Error("Thiếu masp.");

  // Xác thực sản phẩm tồn tại trong phạm vi công ty (tr_sanpham bảng thật, cột f_masp).
  const found = (await db.execute(
    sql`SELECT 1 FROM tr_sanpham
        WHERE company_id = ${companyId}::uuid AND f_masp = ${masp} AND deleted_at IS NULL
        LIMIT 1`,
  )) as unknown as unknown[];
  if (!found || found.length === 0) {
    throw new Error(`Sản phẩm "${masp}" không tồn tại trong công ty.`);
  }

  const payload = await callFreecadTool(url, "cad_build_panel_box", {
    masp,
    family: args.family ?? "panel_box",
    params: args.params ?? {},
    format: args.format,
  });

  const fmt = (payload.format ?? "svg") as DrawingExt;
  const drawingB64 = payload[fmt] ?? payload.svg ?? payload.html ?? payload.pdf;
  if (!drawingB64) throw new Error("Engine CAD không trả bản vẽ 2D.");

  const extras: Array<{ name: string; base64: string }> = [];
  if (payload.step) extras.push({ name: "model.step", base64: payload.step });
  if (payload.stl) extras.push({ name: "model.stl", base64: payload.stl });
  if (payload.png) extras.push({ name: "preview.png", base64: payload.png });

  const saved = await persistDrawing(db, companyId, {
    masp,
    drawing: { ext: fmt, base64: drawingB64 },
    extras,
    createdBy: args.createdBy ?? null,
  });

  return {
    ok: true,
    drawingId: saved.id,
    drawingUrl: saved.url,
    format: fmt,
    filepath: saved.filepath,
    extras: saved.extras,
  };
}
