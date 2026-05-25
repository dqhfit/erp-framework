/* ==========================================================
   tools.ts — Client SDK cho tools.* của server.
   Tools = artifact ngoài monorepo, có manifest, discover qua
   auto-scan + registerRemote. Khác plugins (in-process module).
   ========================================================== */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

export type ToolKind = "web-app" | "mcp-server" | "cli" | "plugin";
export type ToolRuntime = "embedded" | "spawn" | "remote";
export type ToolStatus =
  | "discovered" | "validated" | "enabled" | "running" | "mounted" | "error";

export interface ToolIODef {
  name: string;
  type: string;
  required?: boolean;
  mediaType?: string;
  description?: string;
  schema?: Record<string, unknown>;
}

export interface ToolActionDef {
  name: string;
  description?: string;
  inputs?: ToolIODef[];
  outputs?: ToolIODef[];
}

export interface ToolManifestView {
  id: string;
  name: string;
  version: string;
  displayName: string;
  description?: string;
  category?: string;
  icon?: string;
  kind: ToolKind;
  runtime: ToolRuntime;
  entry: string;
  inputs: ToolIODef[];
  outputs: ToolIODef[];
  actions: ToolActionDef[];
  permissions: string[];
  tags: string[];
  remoteUrl?: string;
  proxy?: { mountPath?: string; forwardAuth?: boolean };
}

export interface ToolListItem {
  id: string;
  slug: string;
  name: string;
  displayName: string | null;
  kind: ToolKind;
  runtime: ToolRuntime;
  manifest: ToolManifestView;
  source: unknown;
  enabledGlobal: boolean;
  enabledForCompany: boolean;
  status: ToolStatus;
  runtimeMeta?: {
    pid?: number; port?: number; mountPath?: string;
    /** ISO date string từ server (tRPC default serializer). */
    startedAt?: string;
  };
  /** ISO date string. */
  updatedAt: string;
}

export interface ToolInvokeArgs {
  toolId: string;
  action: string;
  args?: Record<string, unknown>;
}

export function createToolsClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: baseUrl.replace(/\/$/, "") + "/trpc",
      fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
    })],
  });
  return {
    list: () => trpc.tools.list.query() as unknown as Promise<ToolListItem[]>,
    get: (id: string) => trpc.tools.get.query(id),
    getStatus: (id: string) => trpc.tools.getStatus.query(id),
    /** Trả URL nhúng iframe — cùng-origin (proxy). */
    getProxyUrl: (id: string) => trpc.tools.getProxyUrl.query(id),
    /** Admin: quét lại TOOLS_DIR. */
    rescan: () => trpc.tools.rescan.mutate(),
    /** Admin: đăng ký 1 manifest URL từ remote (chặn SSRF). */
    registerRemote: (manifestUrl: string) =>
      trpc.tools.registerRemote.mutate({ manifestUrl }),
    /** Bật/tắt tool cho công ty hiện tại + lưu config (token, endpoint…). */
    enableForCompany: (
      toolId: string, enabled: boolean, config?: Record<string, unknown>,
    ) => trpc.tools.enableForCompany.mutate({ toolId, enabled, config }),
    /** Lifecycle spawn-runtime tools (web-app/mcp-server/cli stdio). */
    spawn: (toolId: string) => trpc.tools.spawn.mutate(toolId),
    stop: (toolId: string) => trpc.tools.stop.mutate(toolId),
    /** Invoke 1 action — dispatch theo kind (cli/mcp/web-app). */
    invokeAction: (input: ToolInvokeArgs) =>
      trpc.tools.invokeAction.mutate({
        toolId: input.toolId,
        action: input.action,
        args: input.args ?? {},
      }),
  };
}

export type ToolsClient = ReturnType<typeof createToolsClient>;
