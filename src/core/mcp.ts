export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: { type: string; properties?: Record<string, unknown>; required?: string[] };
}

export interface McpConfig {
  mode: "demo" | "http";
  url?: string;
  headers?: Record<string, string>;
}

let seq = 1;

export class McpClient {
  config: McpConfig;
  tools: McpTool[] = [];
  connected = false;

  constructor(config: McpConfig = { mode: "demo" }) {
    this.config = config;
  }

  async connect(): Promise<McpTool[]> {
    if (this.config.mode === "demo") {
      this.tools = DEMO_TOOLS;
      this.connected = true;
      return this.tools;
    }
    if (!this.config.url) throw new Error("MCP URL required");
    // initialize
    await this.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "erp-framework", version: "0.1.0" },
    });
    const res = await this.rpc<{ tools: McpTool[] }>("tools/list", {});
    this.tools = res.tools ?? [];
    this.connected = true;
    return this.tools;
  }

  async callTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    if (this.config.mode === "demo") {
      const tool = DEMO_TOOLS.find((t) => t.name === name);
      if (!tool) throw new Error(`Tool ${name} not found`);
      return demoHandler(name, args) as T;
    }
    const res = await this.rpc<{ content: Array<{ type: string; text?: string }> }>("tools/call", {
      name,
      arguments: args,
    });
    // MCP trả content[]; nếu text → parse JSON, else return raw
    const first = res.content?.[0];
    if (first?.type === "text" && first.text) {
      try {
        return JSON.parse(first.text) as T;
      } catch {
        return first.text as unknown as T;
      }
    }
    return res as unknown as T;
  }

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    if (!this.config.url) throw new Error("URL required");
    const id = seq++;
    const res = await fetch(this.config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...this.config.headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    if (!res.ok) throw new Error(`MCP ${res.status}: ${await res.text()}`);
    const text = await res.text();
    // SSE response: parse "data: {...}\n\n"
    let data: { result?: T; error?: { message: string } };
    if (text.startsWith("event:") || text.includes("\ndata: ")) {
      const lines = text.split("\n").filter((l) => l.startsWith("data: "));
      data = JSON.parse(lines[lines.length - 1]?.slice(6));
    } else {
      data = JSON.parse(text);
    }
    if (data.error) throw new Error(data.error.message);
    return data.result as T;
  }
}

// ========== Demo tools (offline) ==========
const DEMO_TOOLS: McpTool[] = [
  { name: "get_revenue_today", description: "Doanh thu hôm nay" },
  { name: "list_customers", description: "Danh sách khách hàng" },
  { name: "create_order", description: "Tạo đơn hàng" },
];
function demoHandler(name: string, _args: Record<string, unknown>): unknown {
  if (name === "get_revenue_today") return { total: 12_345_678, currency: "VND" };
  if (name === "list_customers")
    return {
      items: Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        name: `KH ${i + 1}`,
        phone: `09${String(i).padStart(8, "0")}`,
      })),
    };
  return { ok: true };
}
