import { useEffect, useState } from "react";
import { McpClient, type McpTool } from "@/core/mcp";
import { useSettings } from "@/stores/settings";

let clientInstance: McpClient | null = null;
let toolsCache: McpTool[] = [];

/** Singleton McpClient + auto-connect dựa trên settings */
export function useMcpClient() {
  const mcpCfg = useSettings((s) => s.mcp);
  const [tools, setTools] = useState<McpTool[]>(toolsCache);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setConnecting(true);
      setError("");
      try {
        clientInstance = new McpClient(mcpCfg);
        const t = await clientInstance.connect();
        if (!cancelled) {
          toolsCache = t;
          setTools(t);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setConnecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mcpCfg]);

  return { client: clientInstance, tools, connecting, error };
}

/** Helper: gọi 1 tool 1 lần (không cần hook) */
export async function callMcpTool<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!clientInstance) throw new Error("MCP client chưa connect");
  return clientInstance.callTool<T>(name, args);
}
