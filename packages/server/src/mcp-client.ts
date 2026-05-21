/* ==========================================================
   mcp-client.ts — Gọi MCP tool phía server cho node "action".
   Đọc cấu hình từ bảng mcp_configs, gọi JSON-RPC tools/call
   qua HTTP.

   Lưu ý: MCP server tuân thủ chặt cần handshake initialize +
   session id; bản này gọi thẳng tools/call (đủ cho MCP-over-HTTP
   đơn giản). Bổ sung handshake là phần mở rộng — vì callTool
   được tiêm dạng callback nên nâng cấp không đụng workflow runner.
   ========================================================== */
import { mcpConfigs } from "@erp-framework/db";
import type { DB } from "./db";
import type { RunWorkflowOptions } from "@erp-framework/core";

interface McpCfg {
  mode?: string;
  url?: string;
  headers?: Record<string, string>;
}

async function mcpToolsCall(
  cfg: McpCfg,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!cfg.url) throw new Error("MCP config thiếu URL");
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cfg.headers ?? {}) },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  if (!res.ok) {
    throw new Error(`MCP lỗi ${res.status}: ${await res.text()}`);
  }
  const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (j.error) throw new Error(`MCP: ${j.error.message ?? "lỗi không rõ"}`);
  return j.result;
}

/** Tạo hàm callTool cho workflow runner — đọc cấu hình MCP từ DB. */
export function makeCallTool(db: DB): RunWorkflowOptions["callTool"] {
  return async (name, args) => {
    const rows = await db.select().from(mcpConfigs).limit(1);
    const cfg = rows[0]?.config as McpCfg | undefined;
    if (!cfg || cfg.mode === "demo") {
      // Demo mode / chưa cấu hình MCP — trả placeholder, không gọi mạng.
      return { _demo: true, tool: name, args };
    }
    return mcpToolsCall(cfg, name, args);
  };
}
