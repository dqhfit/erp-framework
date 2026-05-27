/* ==========================================================
   mssql-connections.ts — Client wrapper cho tRPC
   mssqlConnections.* (CRUD kết nối MSSQL legacy + testConnect).
   ========================================================== */

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

export interface MssqlConnectionView {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  encrypt: boolean;
  trustServerCert: boolean;
  allowWrite: boolean;
  isDefault: boolean;
  hasPassword: boolean;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface MssqlConnectionSaveInput {
  id?: string;
  name: string;
  host: string;
  port?: number;
  database: string;
  username: string;
  password?: string;
  encrypt?: boolean;
  trustServerCert?: boolean;
  allowWrite?: boolean;
  isDefault?: boolean;
}

export interface MssqlTestResult {
  ok: boolean;
  tableCount?: number;
  sample?: Array<{ schema: string; name: string }>;
  error?: string;
}

export function createMssqlConnectionsClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: baseUrl.replace(/\/$/, "") + "/trpc",
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
      }),
    ],
  });
  return {
    list: () => trpc.mssqlConnections.list.query() as Promise<MssqlConnectionView[]>,
    get: (id: string) => trpc.mssqlConnections.get.query(id) as Promise<MssqlConnectionView | null>,
    save: (input: MssqlConnectionSaveInput) =>
      trpc.mssqlConnections.save.mutate({
        port: 1433,
        encrypt: true,
        trustServerCert: false,
        allowWrite: false,
        isDefault: false,
        ...input,
      }) as Promise<{ id: string }>,
    delete: (id: string) => trpc.mssqlConnections.delete.mutate(id),
    setDefault: (id: string) => trpc.mssqlConnections.setDefault.mutate(id),
    testConnect: (id: string) =>
      trpc.mssqlConnections.testConnect.mutate(id) as Promise<MssqlTestResult>,
    listTables: (connectionId: string) =>
      trpc.mssqlConnections.listTables.query({ connectionId }) as Promise<
        Array<{ schema: string; name: string }>
      >,
  };
}

export type MssqlConnectionsClient = ReturnType<typeof createMssqlConnectionsClient>;
