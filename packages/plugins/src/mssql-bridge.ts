/* ==========================================================
   mssql-bridge.ts — McpConnectorPlugin cho phép procedure-JS
   và workflow gọi xuống MSSQL legacy trong giai đoạn quá độ.

   Procedure gọi:  await callTool("mssql.query",   { sql: "SELECT 1", params: {} })
                   await callTool("mssql.execProc",{ name: "dbo.sp_X", params: {} })
                   await callTool("mssql.bulkRead",{ table: "dbo.Orders", limit: 100 })
                   await callTool("mssql.listTables", {})

   Bảo mật:
   - Mặc định read-only (env MSSQL_ALLOW_WRITE=0). bulkRead/listTables vẫn OK.
   - RBAC do procedure-runner kiểm tra ở lớp trên — plugin tin caller.
   - Tắt plugin khi cutover module cuối → không đặt plugin này vào
     pluginRegistry sẵn; phải register tường minh từ boot script.

   Lazy connect: không mở pool khi register; chỉ connect khi callTool
   thực sự gọi → boot không yêu cầu env MSSQL.
   ========================================================== */

import type { PluginModule } from "@erp-framework/core";
import { MssqlClient } from "@erp-framework/mssql-client";

let clientSingleton: MssqlClient | null = null;
let connectPromise: Promise<void> | null = null;

async function getClient(): Promise<MssqlClient> {
  if (!clientSingleton) {
    clientSingleton = MssqlClient.fromEnv();
  }
  if (!connectPromise) {
    connectPromise = clientSingleton.connect();
  }
  await connectPromise;
  return clientSingleton;
}

/** Gọi để tắt kết nối khi shutdown — bridge plug-in muốn gọi từ shutdownTools. */
export async function shutdownMssqlBridge(): Promise<void> {
  if (clientSingleton) {
    await clientSingleton.close();
    clientSingleton = null;
    connectPromise = null;
  }
}

/** Module plugin — register từ boot script khi cần MSSQL bridge. */
export const mssqlBridgePlugins: PluginModule = {
  name: "@erp-framework/mssql-bridge",
  apiVersion: "0.1.0",
  plugins: [
    {
      kind: "mcp-connector",
      id: "mssql",
      label: "MSSQL Bridge (legacy)",
      callTool: async (name, args) => {
        const client = await getClient();
        switch (name) {
          case "mssql.query":
            return client.query(expectString(args, "sql"), expectRecord(args, "params") ?? {});
          case "mssql.execProc":
            return client.execProc(expectString(args, "name"), expectRecord(args, "params") ?? {});
          case "mssql.bulkRead":
            return client.bulkRead(expectString(args, "table"), {
              where: typeof args.where === "string" ? args.where : undefined,
              limit: typeof args.limit === "number" ? args.limit : undefined,
            });
          case "mssql.listTables":
            return client.listTables(typeof args.schema === "string" ? args.schema : undefined);
          case "mssql.listProcs":
            return client.listProcs(typeof args.filter === "string" ? args.filter : undefined);
          case "mssql.getProc": {
            const sch = expectString(args, "schema");
            const nm = expectString(args, "name");
            return client.getProc(sch, nm);
          }
          default:
            throw new Error(`mssql-bridge: tool không hỗ trợ: ${name}`);
        }
      },
    },
  ],
};

function expectString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || !v) {
    throw new Error(`mssql-bridge: thiếu hoặc sai kiểu arg "${key}" (mong đợi string)`);
  }
  return v;
}

function expectRecord(args: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = args[key];
  if (v == null) return null;
  if (typeof v !== "object" || Array.isArray(v)) {
    throw new Error(`mssql-bridge: arg "${key}" phải là object`);
  }
  return v as Record<string, unknown>;
}
