/* ==========================================================
   migration-sync.ts — Client wrapper cho tRPC migrationSync.*.
   Delta-sync MSSQL->PG: list modules, enable/disable, CT script,
   sync now, cutover checklist, execute/rollback cutover.
   ========================================================== */

import type { AppRouter } from "@erp-framework/server";
import { createTRPCClient, httpBatchLink } from "@trpc/client";

export interface SyncTableRow {
  id: string;
  connectionId: string;
  module: string;
  tableName: string;
  entityId: string | null;
  pkColumn: string | null;
  mode: string;
  enabled: boolean;
  status: string;
  ctLastVersion: number | null;
  pendingChanges: number | null;
  insertsCount: number;
  updatesCount: number;
  deletesCount: number;
  lastSyncedAt: Date | string | null;
  lastError: string | null;
  updatedAt: Date | string;
}

export interface SyncModuleRow {
  id: string;
  connectionId: string;
  module: string;
  enabled: boolean;
  cronExpr: string;
  heartbeatAt: Date | string | null;
  updatedAt: Date | string;
  tables: SyncTableRow[];
}

export interface CutoverCheck {
  id: string;
  label: string;
  pass: boolean;
  detail?: string;
}

export function createMigrationSyncClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${baseUrl.replace(/\/$/, "")}/trpc`,
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
      }),
    ],
  });
  return {
    listSyncModules: () => trpc.migrationSync.listSyncModules.query() as Promise<SyncModuleRow[]>,

    enableModuleSync: (input: {
      connectionId: string;
      module: string;
      cronExpr?: string;
      tables: Array<{
        tableName: string;
        pkColumn?: string;
        mode?: "ct" | "rescan" | "manual";
      }>;
    }) =>
      trpc.migrationSync.enableModuleSync.mutate(input) as Promise<{
        modId: string;
        created: string[];
      }>,

    disableModuleSync: (connectionId: string, module: string) =>
      trpc.migrationSync.disableModuleSync.mutate({ connectionId, module }) as Promise<{
        ok: boolean;
      }>,

    setSyncTableMode: (syncTableId: string, mode: "ct" | "rescan" | "manual") =>
      trpc.migrationSync.setSyncTableMode.mutate({ syncTableId, mode }) as Promise<{
        ok: boolean;
      }>,

    runModuleSyncNow: (connectionId: string, module: string) =>
      trpc.migrationSync.runModuleSyncNow.mutate({ connectionId, module }),

    generateCtEnableScript: (connectionId: string, schemaTables: string[], retentionDays = 7) =>
      trpc.migrationSync.generateCtEnableScript.query({
        connectionId,
        schemaTables,
        retentionDays,
      }) as Promise<{ script: string }>,

    checkCtStatus: (connectionId: string, schemaTables?: string[]) =>
      trpc.migrationSync.checkCtStatus.query({ connectionId, schemaTables }) as Promise<{
        dbEnabled: boolean;
        retentionDays: number | null;
        tables: Array<{
          schemaTable: string;
          enabled: boolean;
          minValidVersion: number | null;
        }>;
      }>,

    cutoverChecklist: (connectionId: string, module: string) =>
      trpc.migrationSync.cutoverChecklist.query({ connectionId, module }) as Promise<{
        checks: CutoverCheck[];
        allPass: boolean;
      }>,

    executeCutover: (connectionId: string, module: string) =>
      trpc.migrationSync.executeCutover.mutate({
        connectionId,
        module,
        confirmedDqhfFrozen: true,
      }) as Promise<{ ok: boolean; flippedTables: number }>,

    rollbackCutover: (connectionId: string, module: string) =>
      trpc.migrationSync.rollbackCutover.mutate({ connectionId, module }) as Promise<{
        ok: boolean;
        restoredTables: number;
      }>,
  };
}

export type MigrationSyncClient = ReturnType<typeof createMigrationSyncClient>;
