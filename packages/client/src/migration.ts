/* ==========================================================
   migration.ts — Client wrapper cho tRPC migration.*.
   Dùng từ UI Settings/Migration để list module, start job,
   poll status, đọc ai-log.
   ========================================================== */

import type { AppRouter } from "@erp-framework/server";
import { createTRPCClient, httpBatchLink } from "@trpc/client";

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
      procName?: string;
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

    /* ── Phase Q — Pre-import live tables + defer dirty proc ──── */

    /** Q1: Query sys.dm_exec_procedure_stats từ MSSQL — caller hợp với
     *  markProcActivity để ghi vào manifest. */
    detectActiveProcs: () =>
      trpc.migration.detectActiveProcs.mutate() as Promise<{
        readAt: string;
        total: number;
        procs: Array<{
          schema: string;
          name: string;
          fullName: string;
          lastExecAt: string | null;
          execCount: number;
          inManifest: boolean;
        }>;
      }>,

    /** Q1: Ghi cờ active + stats vào manifest cho 1 module. */
    markProcActivity: (input: {
      module: string;
      readAt: string;
      marks: Array<{
        procName: string;
        active: boolean;
        lastExecAt?: string | null;
        execCount?: number;
      }>;
    }) =>
      trpc.migration.markProcActivity.mutate(input) as Promise<{
        updated: number;
        procs: string[];
      }>,

    /** Q2: Tổng hợp bảng live/dead cross-module để FE preview trước khi
     *  bulk migrate. */
    getLiveTablesAcrossModules: () =>
      trpc.migration.getLiveTablesAcrossModules.query() as Promise<{
        modules: string[];
        liveTables: Array<{
          name: string;
          module: string;
          entityName?: string;
          label?: string;
          kind: "entity" | "enum";
          migratedAt?: string;
          touchedBy: string[];
        }>;
        deadTables: Array<{
          name: string;
          module: string;
          entityName?: string;
          label?: string;
          kind: "entity" | "enum";
          migratedAt?: string;
          touchedBy: string[];
        }>;
        stats: {
          modulesScanned: number;
          totalProcs: number;
          activeProcs: number;
          deadProcs: number;
          unknownProcs: number;
          totalTables: number;
          liveTables: number;
          deadTables: number;
          migratedTables: number;
        };
      }>,

    /** Q3: Bulk ETL nhiều bảng cùng lúc → entity_records. */
    bulkMigrateLiveTables: (input: {
      tableNames: string[];
      limitPerTable?: number;
      dryRun?: boolean;
      force?: boolean;
    }) =>
      trpc.migration.bulkMigrateLiveTables.mutate({
        limitPerTable: 10_000,
        dryRun: false,
        force: false,
        ...input,
      }) as Promise<{
        dryRun: boolean;
        total: number;
        succeeded: number;
        failed: number;
        totalRowsRead: number;
        totalRowsUpserted: number;
        totalRowsUpdated: number;
        truncatedTables: string[];
        results: Array<{
          tableName: string;
          entityName?: string;
          ok: boolean;
          skipped?: string;
          rowsRead: number;
          rowsUpserted: number;
          rowsUpdated: number;
          rowsDeleted: number;
          truncated: boolean;
          unmappedColumns: string[];
          error?: string;
          durationMs: number;
        }>;
      }>,

    /** Q4: Codegen guard — check 1 proc có sẵn sàng codegen chưa. */
    getProcMigrationStatus: (module: string, procName: string) =>
      trpc.migration.getProcMigrationStatus.query({ module, procName }) as Promise<{
        procName: string;
        active: boolean;
        isClean: boolean;
        canCodegen: boolean;
        missingTables: Array<{ table: string; reason: string }>;
        touchedTables: string[];
        suggestedAction: "codegen" | "wait" | "mark-inactive";
      }>,

    /* ── Phase S — Quick migrate ──────────────────────────── */

    /** S1: Liệt kê bảng từ 1 MSSQL connection — kèm rowCount approx. */
    listConnectionTables: (connectionId: string) =>
      trpc.migration.listConnectionTables.query({ connectionId }) as Promise<
        Array<{
          schema: string;
          name: string;
          fullName: string;
          rowCount: number | null;
        }>
      >,

    /** S1: Preview 1 bảng — columns + sample + suggested entity/fields. */
    previewQuickTable: (connectionId: string, tableName: string, samples: number = 5) =>
      trpc.migration.previewQuickTable.query({ connectionId, tableName, samples }) as Promise<{
        tableName: string;
        info: {
          schema: string;
          name: string;
          columns: Array<{ name: string; dataType: string; isNullable: boolean }>;
          primaryKey: string[];
          foreignKeys: Array<{ column: string; refTable: string; refColumn: string }>;
        };
        samples: Array<Record<string, unknown>>;
        suggested: {
          entityName: string;
          label: string;
          fields: Array<{ name: string; label: string; type: string }>;
        };
      }>,

    /** S1: Bulk ETL nhiều bảng qua quick migrate path. Truyền `pkField`
     *  để upsert theo PK (chống duplicate khi migrate lại). */
    quickMigrateTables: (input: {
      connectionId: string;
      items: Array<{
        tableName: string;
        entityName: string;
        label: string;
        fields: Array<{ name: string; label: string; type: string }>;
        force?: boolean;
        pkField?: string;
      }>;
      limitPerTable?: number;
      dryRun?: boolean;
      writeManifest?: boolean;
    }) =>
      trpc.migration.quickMigrateTables.mutate({
        limitPerTable: 10_000,
        dryRun: false,
        writeManifest: true,
        ...input,
        items: input.items.map((it) => ({ force: false, ...it })),
      }) as Promise<{
        dryRun: boolean;
        connectionId: string;
        moduleName: string;
        total: number;
        succeeded: number;
        failed: number;
        totalRowsRead: number;
        totalRowsUpserted: number;
        totalRowsUpdated: number;
        results: Array<{
          tableName: string;
          entityName: string;
          ok: boolean;
          skipped?: string;
          rowsRead: number;
          rowsUpserted: number;
          rowsUpdated: number;
          rowsDeleted: number;
          truncated: boolean;
          error?: string;
          durationMs: number;
        }>;
      }>,

    /* ── Phase U — Full import (queue + resume + sync) ────── */

    /** U4: Tạo full-import job — bảng đã chọn import toàn bộ qua queue. */
    startFullImport: (input: {
      connectionId: string;
      items: Array<{
        tableName: string;
        entityName: string;
        label: string;
        fields: Array<{ name: string; label: string; type: string }>;
      }>;
      batchSize?: number;
      writeManifest?: boolean;
    }) =>
      trpc.migration.startFullImport.mutate({
        batchSize: 5000,
        writeManifest: true,
        ...input,
      }) as Promise<{ jobId: string }>,

    /** U4: List full jobs với progress summary. */
    listFullJobs: (filter?: {
      connectionId?: string;
      statuses?: Array<"queued" | "running" | "paused" | "completed" | "failed" | "canceled">;
    }) =>
      trpc.migration.listFullJobs.query(filter) as Promise<
        Array<{
          id: string;
          connectionId: string;
          connectionName: string;
          kind: string;
          status: string;
          totalTables: number;
          completedTables: number;
          totalRowsImported: number;
          startedAt: string | null;
          completedAt: string | null;
          lastHeartbeat: string;
          error: string | null;
          createdAt: string;
          updatedAt: string;
        }>
      >,

    /** U4: Chi tiết per-table của 1 job. */
    getFullJobDetail: (jobId: string) =>
      trpc.migration.getFullJobDetail.query({ jobId }) as Promise<{
        job: {
          id: string;
          kind: string;
          status: string;
          totalTables: number;
          completedTables: number;
          totalRowsImported: number;
          startedAt: string | null;
          completedAt: string | null;
          lastHeartbeat: string;
          error: string | null;
        };
        tables: Array<{
          id: string;
          tableName: string;
          entityName: string;
          pkColumn: string | null;
          lastPk: string | null;
          rowsImported: number;
          batchSize: number;
          status: string;
          error: string | null;
          updatedAt: string;
        }>;
      }>,

    /** U4: Resume 1 job (re-enqueue). mode='resume' retry failed, 'sync' reset done. */
    resumeFullJob: (jobId: string, mode: "resume" | "sync" = "resume") =>
      trpc.migration.resumeFullJob.mutate({ jobId, kind: mode }) as Promise<{
        jobId: string;
        status: string;
        mode: "resume" | "sync";
      }>,

    /** U4: Cancel 1 job. */
    cancelFullJob: (jobId: string) =>
      trpc.migration.cancelFullJob.mutate({ jobId }) as Promise<{
        jobId: string;
        status: string;
      }>,

    /* ── Phase V — Auto master-detail page ────────────────── */

    /** V1: Sinh page split-pane master-detail cho 1 entity. */
    generateMasterDetailPage: (input: {
      entityId: string;
      pageName?: string;
      pageLabel?: string;
    }) =>
      trpc.migration.generateMasterDetailPage.mutate(input) as Promise<{
        pageId: string;
        pageName: string;
        pageLabel: string;
        upserted: "created" | "updated";
        masterEntity: string;
        forwardRefs: Array<{ field: string; refEntityId: string }>;
        backwardChildren: Array<{
          entityId: string;
          entityName: string;
          entityLabel: string;
          fkField: string;
          label?: string;
          source: "collection" | "backward-ref";
        }>;
      }>,

    /* ── Phase T — Tracking + cleanup an toàn ──────────────── */

    /** T2: Liệt kê entity do migration tạo. */
    listMigratedEntities: (filter?: { connectionId?: string; module?: string }) =>
      trpc.migration.listMigratedEntities.query(filter) as Promise<
        Array<{
          id: string;
          name: string;
          label: string;
          mssqlTable: string | null;
          module: string | null;
          connectionId: string | null;
          connectionName: string | null;
          importedAt: string | null;
          rowsLastImported: number;
          recordCount: number;
          createdAt: string;
          updatedAt: string;
        }>
      >,

    /** T2: Cleanup 1 entity migrate. Mode = records-only / entity-and-records / re-migrate. */
    cleanupMigratedEntity: (input: {
      entityId: string;
      mode: "records-only" | "entity-and-records" | "re-migrate";
    }) =>
      trpc.migration.cleanupMigratedEntity.mutate(input) as Promise<
        | {
            mode: "records-only";
            entityId: string;
            deletedRecords: number;
            entityKept: true;
          }
        | {
            mode: "entity-and-records";
            entityId: string;
            deletedRecords: number;
            entityDeleted: true;
          }
        | {
            mode: "re-migrate";
            entityId: string;
            rowsRead: number;
            rowsUpserted: number;
          }
      >,

    /** T2: Bulk cleanup theo scope. */
    cleanupAllMigrated: (input: {
      scope?: { connectionId?: string; module?: string };
      mode: "records-only" | "entity-and-records" | "re-migrate";
    }) =>
      trpc.migration.cleanupAllMigrated.mutate({
        scope: input.scope ?? {},
        mode: input.mode,
      }) as Promise<{
        total: number;
        succeeded: number;
        failed: number;
        results: Array<{ entityId: string; name: string; ok: boolean; error?: string }>;
      }>,

    /** V2 — Tab Procedures: list proc theo bảng đã migrate. */
    listProcsToMigrate: (input: {
      module: string;
      filterMode?: "all" | "reads-only";
      activeWithinDays?: number;
      sortBy?: "complexity-asc" | "complexity-desc" | "name";
      includeBlocked?: boolean;
    }) => trpc.migration.listProcsToMigrate.query(input),

    /** V2 — Aggregate cross-module: list proc của TẤT CẢ module YAML. */
    listAllProcsToMigrate: (
      input: {
        filterMode?: "all" | "reads-only";
        activeWithinDays?: number;
        sortBy?: "complexity-asc" | "complexity-desc" | "name";
        includeBlocked?: boolean;
        moduleFilter?: string;
      } = {},
    ) => trpc.migration.listAllProcsToMigrate.query(input),

    /** V2 — AI phân loại nghiệp vụ. mode mặc định "skip-existing" để chạy
     *  lại nhiều lần không drift kết quả. */
    classifyProcsAi: (input: {
      module: string;
      names?: string[];
      connectionId?: string;
      mode?: "skip-existing" | "if-stale" | "force";
    }) =>
      trpc.migration.classifyProcsAi.mutate({
        module: input.module,
        names: input.names ?? [],
        connectionId: input.connectionId,
        mode: input.mode ?? "skip-existing",
      }),

    /** V2 — User set businessCategory override. */
    setProcCategory: (input: {
      module: string;
      procName: string;
      category:
        | "create"
        | "read"
        | "update"
        | "delete"
        | "report"
        | "validation"
        | "calculation"
        | "workflow"
        | "trigger"
        | "batch"
        | "unknown"
        | null;
    }) => trpc.migration.setProcCategory.mutate(input),

    /** V2 — Tier C workflow codegen dry-run. useCache=true (default) trả cache
     *  nếu bodyHash khớp → idempotent + tiết kiệm chi phí LLM. */
    codegenProcWorkflowDryRun: (input: {
      module: string;
      procName: string;
      connectionId?: string;
      useCache?: boolean;
    }) =>
      trpc.migration.codegenProcWorkflowDryRun.mutate({
        ...input,
        useCache: input.useCache ?? true,
      }),

    /** V2 — Tier C workflow apply. overwriteIfExists=false (default) bảo vệ
     *  graph user đã sửa thủ công sau lần apply đầu. */
    codegenProcWorkflowApply: (input: {
      module: string;
      procName: string;
      graph: { nodes: unknown[]; edges: unknown[] };
      workflowName?: string;
      overwriteIfExists?: boolean;
    }) =>
      trpc.migration.codegenProcWorkflowApply.mutate({
        ...input,
        graph: input.graph as {
          nodes: Record<string, unknown>[];
          edges: Record<string, unknown>[];
        },
        overwriteIfExists: input.overwriteIfExists ?? false,
      }),

    /** V2 — Tab Quan hệ: list migrated entities + hint FK. */
    listMigratedRelations: (input: { module?: string } = {}) =>
      trpc.migration.listMigratedRelations.query(input),

    /** V2 — Apply 1 hint hoặc xoá ref. targetEntityId=null → unset. */
    applyRelationHint: (input: {
      sourceEntityId: string;
      sourceField: string;
      targetEntityId: string | null;
    }) => trpc.migration.applyRelationHint.mutate(input),

    /** Phân tích SQL tùy ý — trích xuất JOIN pairs, map sang entity đã
     *  migrate, trả gợi ý ref để user xác nhận + apply. */
    analyzeRelationsFromSql: (sql: string) =>
      trpc.migration.analyzeRelationsFromSql.mutate({ sql }) as Promise<{
        joinPairsTotal: number;
        hints: Array<{
          sourceEntityId: string;
          sourceEntityName: string;
          sourceEntityLabel: string;
          sourceField: string;
          sourceFieldLabel: string;
          targetEntityId: string;
          targetEntityName: string;
          targetEntityLabel: string;
          targetField: string;
          applied: boolean;
        }>;
        unmappedTables: string[];
      }>,
  };
}

export type MigrationClient = ReturnType<typeof createMigrationClient>;
