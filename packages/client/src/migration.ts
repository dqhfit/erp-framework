/* ==========================================================
   migration.ts — Client wrapper cho tRPC migration.*.
   Dùng từ UI Settings/Migration để list module, start job,
   poll status, đọc ai-log.
   ========================================================== */

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

export type MigrationAction =
  | "discover"
  | "enrich"
  | "capture-golden"
  | "generate"
  | "data"
  | "audit";

export interface MigrationModuleSummary {
  name: string;
  phase: string;
  tableCount: number;
  procCount: number;
  updatedAt: string;
}

export interface MigrationJobState {
  jobId: string;
  action: MigrationAction;
  module: string;
  status: "queued" | "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  message?: string;
  error?: string;
}

export interface MigrationAiLogEntry {
  file: string;
  phase: string;
  timestamp: string;
  sizeBytes: number;
}

export interface MigrationEnvCheck {
  connectionCount: number;
  hasDefaultConnection: boolean;
  migrationRootExists: boolean;
  modulesDirExists: boolean;
}

export function createMigrationClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: baseUrl.replace(/\/$/, "") + "/trpc",
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
      }),
    ],
  });
  return {
    listModules: () => trpc.migration.listModules.query() as Promise<MigrationModuleSummary[]>,
    getModule: (name: string) => trpc.migration.getModule.query({ name }),
    getModuleYaml: (name: string, variant: "main" | "enriched" = "main") =>
      trpc.migration.getModuleYaml.query({ name, variant }),
    startJob: (action: MigrationAction, module: string, args: Record<string, unknown> = {}) =>
      trpc.migration.startJob.mutate({ action, module, args }) as Promise<{ jobId: string }>,
    jobStatus: (jobId: string) =>
      trpc.migration.jobStatus.query({ jobId }) as Promise<MigrationJobState | null>,
    aiLog: (module: string) =>
      trpc.migration.aiLog.query({ module }) as Promise<MigrationAiLogEntry[]>,
    getAiLogEntry: (module: string, file: string) =>
      trpc.migration.getAiLogEntry.query({ module, file }),
    envCheck: () => trpc.migration.envCheck.query() as Promise<MigrationEnvCheck>,
    previewTable: (tableName: string, samples: number = 5) =>
      trpc.migration.previewTable.query({ tableName, samples }),
    previewProc: (procName: string) => trpc.migration.previewProc.query({ procName }),
    normalizeNamesAi: (module: string) =>
      trpc.migration.normalizeNamesAi.mutate({ module }) as Promise<{
        renames: Array<{
          kind: "entity" | "enum" | "field" | "proc";
          table?: string;
          column?: string;
          currentName: string;
          suggestedName: string;
          reason: string;
          severity: "high" | "medium" | "low";
        }>;
        summary?: string;
        tokensIn: number;
        tokensOut: number;
        durationMs: number;
        error?: string;
        raw?: string;
      }>,
    refreshManifest: (name: string) =>
      trpc.migration.refreshManifest.mutate({ name }) as Promise<{
        at: string;
        tablesAdded: string[];
        tablesRemoved: string[];
        procsAdded: string[];
        procsRemoved: string[];
        columnsAdded: Array<{ table: string; column: string }>;
        columnsRemoved: Array<{ table: string; column: string }>;
      }>,
    getDiagram: (name: string) =>
      trpc.migration.getDiagram.query({ name }) as Promise<{
        nodes: Array<{
          id: string;
          kind: "entity" | "enum";
          entityName: string;
          label: string;
          fieldCount: number;
          enumValueCount: number;
        }>;
        edges: Array<{
          id: string;
          source: string;
          target: string;
          column: string;
          refColumn: string;
        }>;
      }>,
    applyChange: (input: {
      module: string;
      action:
        | { type: "renameEntity"; tableName: string; newName: string }
        | { type: "changeKind"; tableName: string; newKind: "entity" | "enum" }
        | { type: "renameField"; tableName: string; columnName: string; newField: string };
    }) => trpc.migration.applyChange.mutate(input) as Promise<{ changes: string[] }>,
    materializeEnum: (input: {
      module: string;
      tableName: string;
      valueColumn?: string;
      labelColumn?: string;
      extraColumns?: string[];
      limit?: number;
    }) =>
      trpc.migration.materializeEnum.mutate({ limit: 1000, ...input }) as Promise<
        | {
            mode: "single";
            enumId: string;
            enumName: string;
            enumLabel: string;
            valueCount: number;
            valueColumn: string;
            labelColumn: string;
            extraColumns: string[];
            upserted: "created" | "updated";
          }
        | {
            mode: "split";
            results: Array<{
              enumId: string;
              enumName: string;
              enumLabel: string;
              valueCount: number;
              valueColumn: string;
              labelColumn: string;
              extraColumns: string[];
              upserted: "created" | "updated";
            }>;
          }
      >,
    auditModuleDryRun: (module: string) =>
      trpc.migration.auditModuleDryRun.mutate({ module }) as Promise<{
        markdown: string;
        error?: string;
        raw?: string;
        tokensIn: number;
        tokensOut: number;
        durationMs: number;
      }>,
    saveAuditReport: (module: string, markdown: string) =>
      trpc.migration.saveAuditReport.mutate({ module, markdown }) as Promise<{
        filePath: string;
        length: number;
      }>,
    getAuditReport: (module: string) =>
      trpc.migration.getAuditReport.query({ module }) as Promise<{
        filePath: string;
        markdown: string;
        updatedAt: string;
        sizeBytes: number;
      } | null>,
    getReviewStatus: (module: string) =>
      trpc.migration.getReviewStatus.query({ module }) as Promise<{
        module: string;
        phase: string;
        tables: Array<{
          name: string;
          entityName?: string;
          kind: "entity" | "enum";
          label?: string;
          enriched: boolean;
          enumMaterialized: boolean;
          enumId: string | null;
        }>;
        procs: Array<{
          name: string;
          targetProcName?: string;
          targetFile?: string;
          tier: string;
          label?: string;
          enriched: boolean;
          codegenApplied: boolean;
          codegenTarget: string | null;
          goldenCaptured: boolean;
        }>;
        stats: {
          tables: { total: number; enriched: number; enumTotal: number; enumMaterialized: number };
          procs: {
            total: number;
            enriched: number;
            codegenApplied: number;
            goldenCaptured: number;
            tierC: number;
          };
        };
      }>,
    finalizeModule: (module: string, force: boolean = false) =>
      trpc.migration.finalizeModule.mutate({ module, force }) as Promise<{
        ok: boolean;
        phase: "live";
        cutoverAt: string;
      }>,
    unfinalizeModule: (module: string) =>
      trpc.migration.unfinalizeModule.mutate({ module }) as Promise<{
        ok: boolean;
        phase: "filled";
      }>,
    addToExclude: (input: { module: string; tableNames: string[] }) =>
      trpc.migration.addToExclude.mutate(input) as Promise<{
        addedToExclude: string[];
        removedTables: string[];
        removedRels: number;
        removedProcs: string[];
      }>,
    removeFromExclude: (input: { module: string; tableNames: string[] }) =>
      trpc.migration.removeFromExclude.mutate(input) as Promise<{
        removed: string[];
        currentExclude: string[];
      }>,
    setSplitEnums: (input: {
      module: string;
      tableName: string;
      splitEnums: Array<{
        discriminatorColumn: string;
        discriminatorValue: string;
        name: string;
        label: string;
        description?: string;
        valueColumn?: string;
        labelColumn?: string;
        extraColumns?: string[];
      }>;
    }) => trpc.migration.setSplitEnums.mutate(input) as Promise<{ count: number }>,
    decisionsForTable: (tableName: string) =>
      trpc.migration.decisionsForTable.query({ tableName }) as Promise<
        Array<{ at: string; module: string; action: unknown; by?: string; changes?: string[] }>
      >,
    generateSamplesDryRun: (module: string, procName: string, sampleRowsPerTable: number = 5) =>
      trpc.migration.generateSamplesDryRun.mutate({
        module,
        procName,
        sampleRowsPerTable,
      }) as Promise<{
        procName: string;
        samples: Array<{
          name: string;
          kind: "happy" | "boundary" | "edge";
          description: string;
          args: Record<string, unknown>;
          expectedError?: string;
        }>;
        error?: string;
        raw?: string;
        tokensIn: number;
        tokensOut: number;
        durationMs: number;
      }>,
    captureGolden: (input: {
      module: string;
      procName: string;
      samples: Array<{
        name: string;
        kind: "happy" | "boundary" | "edge";
        description?: string;
        args: Record<string, unknown>;
        expectedError?: string;
      }>;
    }) =>
      trpc.migration.captureGolden.mutate(input) as Promise<{
        filePath: string;
        total: number;
        ok: number;
        failed: number;
        results: Array<{
          name: string;
          kind: "happy" | "boundary" | "edge";
          ok: boolean;
          output?: unknown;
          error?: string;
          durationMs: number;
        }>;
      }>,
    codegenProcDryRun: (module: string, procName: string) =>
      trpc.migration.codegenProcDryRun.mutate({ module, procName }) as Promise<{
        procName: string;
        manifestTier: "B" | "C" | "D";
        output:
          | {
              tier: "B";
              name: string;
              label: string;
              description: string;
              paramsSchema: Array<Record<string, unknown>>;
              code: string;
            }
          | { tier: "D"; fileName: string; exportName: string; description: string; code: string }
          | null;
        error?: string;
        raw?: string;
        tokensIn: number;
        tokensOut: number;
        durationMs: number;
      }>,
    codegenProcApply: (input: {
      module: string;
      tier: "B" | "D";
      code: string;
      name?: string;
      label?: string;
      description?: string;
      paramsSchema?: Array<Record<string, unknown>>;
      fileName?: string;
      overwrite?: boolean;
    }) =>
      trpc.migration.codegenProcApply.mutate(input) as Promise<
        | { tier: "B"; procedureId: string; upserted: "created" | "updated"; name: string }
        | {
            tier: "D";
            filePath: string;
            upserted: "created" | "overwritten" | "conflict";
            message?: string;
          }
      >,
    enrichProcDryRun: (module: string, procName: string) =>
      trpc.migration.enrichProcDryRun.mutate({ module, procName }) as Promise<{
        procName: string;
        output: unknown | null;
        error?: string;
        raw?: string;
        tokensIn: number;
        tokensOut: number;
        durationMs: number;
      }>,
  };
}

export type MigrationClient = ReturnType<typeof createMigrationClient>;
