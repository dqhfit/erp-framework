/* ==========================================================
   migration-router.ts — tRPC endpoints cho UI migration MSSQL.
   - listModules / getModule           — đọc manifest YAML
   - startJob(action, module, args)    — enqueue pg-boss, return jobId
   - jobStatus(jobId)                  — polling fallback (WS là chính)
   - aiLog(module) / getAiLogEntry     — list + xem prompt-response của LLM
   - envCheck                          — kiểm tra env (MSSQL/DB/LLM)
   Toàn bộ rbacProcedure("edit","settings") — admin only.
   ========================================================== */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import {
  entities,
  entityRecords,
  enums,
  llmProfiles,
  migrationFullJobs,
  migrationFullJobTables,
  migrationJobs,
  mssqlConnections,
  pages,
  procedures,
  recordLocator,
  workflows,
} from "@erp-framework/db";
import { runDiscover } from "@erp-framework/migration-cli/discover";
import {
  auditModule,
  codegenProc,
  enrichOneProc,
  generateProcSamples,
  normalizeNames,
  type ProcSample,
} from "@erp-framework/migration-cli/enrich";
import { MssqlClient, analyzeProc } from "@erp-framework/mssql-client";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import YAML from "yaml";
import { z } from "zod";
import { decryptSecret } from "./crypto";
import type { DB } from "./db";
import {
  bodyHash,
  classifyProcsBatch,
  fetchProcBody,
  type ProcClassifyInput,
} from "./migration-classify-ai";
import { validateGeneratedTs } from "./migration-codegen-batch";
import { codegenProcWorkflow } from "./migration-codegen-workflow";
import { verifyProcAgainstGolden } from "./migration-verify";
import {
  findExistingInTable,
  type FullJobItem,
  insertRowToTable,
  prepareFullJobTables,
  updateRowInTable,
} from "./migration-full-import";
import { resolveTableName } from "./entity-promote";
import {
  applyColumnLabels,
  assertIdent,
  type EntityStorage,
  renameTableDDL,
} from "./entity-table-ddl";
import { isHybridTablesEnabled } from "./record-store";
import {
  buildCombinedMigratedSet,
  findMigratedEntityBySourceTable,
} from "./migration-migrated-set";
import { enqueueMigrationJob, getMigrationJobStatus, resumeMigrationJob } from "./migration-worker";
import { logActivity } from "./activity";
import {
  getModuleProc,
  listModuleProcs as listModuleProcsRegistry,
  refreshModuleProcs,
} from "./module-procs";
import { pluginModuleDir, pluginsRoot, repoRoot } from "./repo-paths";
import { rbacProcedure, router } from "./trpc";

const MIGRATION_ROOT = () => resolve(process.cwd(), "migration-plan");
const MODULES_DIR = () => resolve(MIGRATION_ROOT(), "modules");
const AI_LOG_DIR = () => resolve(MIGRATION_ROOT(), "ai-log");
const DECISIONS_FILE = () => resolve(MIGRATION_ROOT(), "decisions.yaml");

/** Số entry tối đa giữ trong decisions.yaml — rotate khi vượt (giữ tail). */
const DECISION_LOG_CAP = 5000;
/** Window dedupe — entry mới có cùng action+args với entry cuối trong window
 *  này sẽ bỏ qua (không thêm). Tránh log phình khi user click lặp lại. */
const DECISION_DEDUPE_WINDOW_MS = 10_000;

/** Ghi log mọi thay đổi manifest vào decisions.yaml shared cross-module.
 *  - Dedupe: nếu entry cuối trong 10s có cùng action+args → bỏ qua.
 *  - Cap: giữ tail DECISION_LOG_CAP entry, rotate khi vượt.
 *  Khi seed module mới mà gặp cùng bảng MSSQL → có thể đọc decision cũ
 *  để auto-apply (vd kind=enum đã quyết). */
function appendDecision(entry: Record<string, unknown>): void {
  const p = DECISIONS_FILE();
  let arr: unknown[] = [];
  if (existsSync(p)) {
    try {
      const raw = YAML.parse(readFileSync(p, "utf8"));
      if (Array.isArray(raw)) arr = raw;
    } catch {
      /* file hỏng → bắt đầu lại */
    }
  }

  // Dedupe: so sánh với entry cuối cùng nếu trong window.
  const last = arr[arr.length - 1] as Record<string, unknown> | undefined;
  if (last && typeof last === "object") {
    const lastAt = typeof last.at === "string" ? Date.parse(last.at) : 0;
    const dt = Date.now() - lastAt;
    if (
      dt >= 0 &&
      dt < DECISION_DEDUPE_WINDOW_MS &&
      last.action === entry.action &&
      last.module === entry.module &&
      JSON.stringify(last.args ?? null) === JSON.stringify(entry.args ?? null)
    ) {
      return; // skip duplicate
    }
  }

  arr.push({ at: new Date().toISOString(), ...entry });

  // Rotate nếu vượt cap.
  if (arr.length > DECISION_LOG_CAP) {
    arr = arr.slice(arr.length - DECISION_LOG_CAP);
  }

  writeFileSync(p, YAML.stringify(arr, { lineWidth: 0 }), "utf8");
}

/** Đọc decisions trùng tableName để auto-apply khi seed module mới. */
function readDecisionsForTable(tableName: string): Array<Record<string, unknown>> {
  const p = DECISIONS_FILE();
  if (!existsSync(p)) return [];
  try {
    const raw = YAML.parse(readFileSync(p, "utf8"));
    if (!Array.isArray(raw)) return [];
    return raw.filter((d) => {
      if (typeof d !== "object" || d == null) return false;
      const a = (d as { args?: { tableName?: string } }).args;
      return a?.tableName?.toLowerCase() === tableName.toLowerCase();
    });
  } catch {
    return [];
  }
}

/* ─── Helper HYBRID: entity tier='table' (bảng thật) ─── */

/** storage tier='table' từ entities.meta, hoặc null nếu entity còn EAV. */
function tableStorageOf(meta: unknown): EntityStorage | null {
  const s = (meta as { storage?: EntityStorage } | null)?.storage;
  return s?.tier === "table" ? s : null;
}

/** Đếm row trong bảng thật của entity (mọi row, gồm soft-deleted — đồng
 *  nhất với count entity_records phía EAV). */
async function countTableRows(db: DB, companyId: string, storage: EntityStorage): Promise<number> {
  const tbl = sql.raw(`"${assertIdent(storage.tableName)}"`);
  const res = (await db.execute(
    sql`SELECT count(*)::int AS n FROM ${tbl} WHERE company_id = ${companyId}::uuid`,
  )) as unknown as Array<{ n: number }> | { rows?: Array<{ n: number }> };
  const list = Array.isArray(res) ? res : (res.rows ?? []);
  return Number(list[0]?.n ?? 0);
}

/** Xoá sạch DATA của entity tier='table': row bảng thật + record_locator +
 *  snapshot EAV đông lạnh (để re-promote/demote không hồi sinh data cũ).
 *  Trả số row bảng thật đã xoá. */
async function purgeTableRows(
  db: DB,
  companyId: string,
  entityId: string,
  storage: EntityStorage,
): Promise<number> {
  const tbl = sql.raw(`"${assertIdent(storage.tableName)}"`);
  const res = (await db.execute(
    sql`DELETE FROM ${tbl} WHERE company_id = ${companyId}::uuid RETURNING id`,
  )) as unknown as Array<{ id: string }> | { rows?: Array<{ id: string }> };
  const deleted = (Array.isArray(res) ? res : (res.rows ?? [])).length;
  await db
    .delete(recordLocator)
    .where(and(eq(recordLocator.companyId, companyId), eq(recordLocator.entityId, entityId)));
  await db
    .delete(entityRecords)
    .where(and(eq(entityRecords.companyId, companyId), eq(entityRecords.entityId, entityId)));
  return deleted;
}

/** Ghi mapped rows vào entity theo tier (HYBRID-aware). Đọc meta TƯƠI từ DB
 *  để biết storage (caller có thể chỉ có meta giả lập từ dedup-by-source).
 *  force=true: xoá sạch records cũ rồi insert fresh; pkField: upsert theo PK;
 *  không có cả hai: insert thẳng (legacy, có thể duplicate). */
async function writeMappedRows(opts: {
  db: DB;
  companyId: string;
  userId: string;
  entityId: string;
  mapped: Array<Record<string, unknown>>;
  pkField?: string | null;
  force?: boolean;
}): Promise<{ rowsUpserted: number; rowsUpdated: number; rowsDeleted: number }> {
  const { db, companyId, userId, entityId, mapped } = opts;
  const [ent] = await db
    .select({ meta: entities.meta })
    .from(entities)
    .where(and(eq(entities.companyId, companyId), eq(entities.id, entityId)))
    .limit(1);
  const storage = tableStorageOf(ent?.meta);

  const insertAll = async (items: Array<Record<string, unknown>>): Promise<number> => {
    if (items.length === 0) return 0;
    if (storage) {
      const newIds: string[] = [];
      for (const d of items) {
        const newId = await insertRowToTable(db, storage, companyId, userId, d);
        if (newId) newIds.push(newId);
      }
      if (newIds.length > 0) {
        await db
          .insert(recordLocator)
          .values(newIds.map((id) => ({ id, companyId, entityId })))
          .onConflictDoNothing();
      }
      return newIds.length;
    }
    const inserted = await db
      .insert(entityRecords)
      .values(items.map((d) => ({ companyId, entityId, data: d, createdBy: userId })))
      .returning({ id: entityRecords.id });
    return inserted.length;
  };

  if (opts.force) {
    let rowsDeleted: number;
    if (storage) {
      rowsDeleted = await purgeTableRows(db, companyId, entityId, storage);
    } else {
      const del = await db
        .delete(entityRecords)
        .where(and(eq(entityRecords.companyId, companyId), eq(entityRecords.entityId, entityId)))
        .returning({ id: entityRecords.id });
      rowsDeleted = del.length;
    }
    return { rowsUpserted: await insertAll(mapped), rowsUpdated: 0, rowsDeleted };
  }

  if (opts.pkField && mapped.length > 0) {
    const pkField = opts.pkField;
    const pkValuesText = mapped
      .map((d) => d[pkField])
      .filter((v) => v != null)
      .map((v) => String(v));
    let existingMap: Map<string, string>; // pkValue → record.id
    if (storage) {
      existingMap = await findExistingInTable(storage, companyId, pkField, pkValuesText);
    } else {
      const existingRows =
        pkValuesText.length > 0
          ? await db
              .select({ id: entityRecords.id, data: entityRecords.data })
              .from(entityRecords)
              .where(
                and(
                  eq(entityRecords.companyId, companyId),
                  eq(entityRecords.entityId, entityId),
                  sql`${entityRecords.data}->>${pkField} = ANY(${pkValuesText}::text[])`,
                ),
              )
          : [];
      existingMap = new Map<string, string>();
      for (const r of existingRows) {
        const pkVal = (r.data as Record<string, unknown>)[pkField];
        if (pkVal != null) existingMap.set(String(pkVal), r.id);
      }
    }

    const toInsert: Array<Record<string, unknown>> = [];
    const toUpdate: Array<{ id: string; data: Record<string, unknown> }> = [];
    for (const d of mapped) {
      const pkVal = d[pkField];
      const existingId = pkVal == null ? undefined : existingMap.get(String(pkVal));
      if (existingId) toUpdate.push({ id: existingId, data: d });
      else toInsert.push(d);
    }

    const rowsUpserted = await insertAll(toInsert);
    for (const u of toUpdate) {
      if (storage) {
        await updateRowInTable(db, storage, u.id, u.data);
      } else {
        await db
          .update(entityRecords)
          .set({ data: u.data, updatedAt: new Date() })
          .where(eq(entityRecords.id, u.id));
      }
    }
    return { rowsUpserted, rowsUpdated: toUpdate.length, rowsDeleted: 0 };
  }

  return { rowsUpserted: await insertAll(mapped), rowsUpdated: 0, rowsDeleted: 0 };
}

/** Cập nhật meta.source — MERGE jsonb (||), KHÔNG ghi đè cả meta (ghi đè sẽ
 *  xoá mất meta.storage của entity đã promote — xem bài học #20 CLAUDE.md). */
async function mergeSourceMeta(
  db: DB,
  entityId: string,
  source: Record<string, unknown>,
): Promise<void> {
  await db
    .update(entities)
    .set({
      meta: sql`coalesce(${entities.meta}, '{}'::jsonb) || ${JSON.stringify({ source })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(entities.id, entityId));
}

/** DROP bảng thật + dọn locator khi xoá hẳn entity tier='table'. Bảng vật lý
 *  KHÔNG nằm trong cascade FK của entities nên phải drop tường minh. */
async function dropTableForEntity(
  db: DB,
  companyId: string,
  entityId: string,
  storage: EntityStorage,
): Promise<void> {
  await db
    .delete(recordLocator)
    .where(and(eq(recordLocator.companyId, companyId), eq(recordLocator.entityId, entityId)));
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${assertIdent(storage.tableName)}"`));
}

const ACTION_VALUES = [
  "discover",
  "enrich",
  "capture-golden",
  "generate",
  "data",
  "audit",
] as const;
const moduleNameSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, "Module name phải snake_case");

/** Shape 1 proc-row chung — dùng bởi cả listProcsToMigrate (per-module)
 *  và listAllProcsToMigrate (cross-module). filterMode ảnh hưởng đến
 *  filterStatus đầu ra (reads-only chấp nhận partial).
 *  dbProcMap: Map<procName.lower → id> để tính codegenApplied tier B. */
function shapeProcRow(
  proc: Record<string, unknown>,
  migrated: Set<string>,
  filterMode: "all" | "reads-only" = "all",
  dbProcMap: Map<string, string> = new Map(),
) {
  const reads = (proc.reads as string[]) ?? [];
  const writes = (proc.writes as string[]) ?? [];
  const flags = (proc.flags as string[]) ?? [];
  const all = [...new Set([...reads, ...writes])];
  const missing = all.filter((t) => !migrated.has(t.toLowerCase()));
  const readsMissing = reads.filter((t) => !migrated.has(t.toLowerCase()));

  let filterStatus: "ready" | "partial" | "blocked";
  if (missing.length === 0) filterStatus = "ready";
  else if (filterMode === "reads-only" && readsMissing.length === 0) filterStatus = "partial";
  else filterStatus = "blocked";

  const complexity =
    reads.length +
    writes.length * 2 +
    ((proc.callsProcs as string[] | undefined)?.length ?? 0) * 3 +
    flags.length * 5;

  const tier = (proc.suggestedTier as "B" | "C" | "D" | undefined) ?? "D";
  let codegenApplied = false;
  if (tier === "B" && proc.targetProcName) {
    codegenApplied = dbProcMap.has((proc.targetProcName as string).toLowerCase());
  } else if (tier === "C" && proc.targetWorkflowId) {
    codegenApplied = true;
  } else if (tier === "D" && proc.targetFile) {
    codegenApplied = existsSync(resolve(repoRoot(), proc.targetFile as string));
  }

  return {
    name: proc.name as string,
    reads,
    writes,
    missingTables: missing,
    filterStatus,
    active: proc.active !== false,
    lastExecAt: (proc.lastExecAt as string | null) ?? null,
    execCount: (proc.execCount as number | undefined) ?? 0,
    complexity,
    suggestedTier: tier,
    businessCategory:
      (proc.userOverrideCategory as string | undefined) ??
      (proc.businessCategory as string | undefined) ??
      null,
    businessCategoryConfidence: (proc.businessCategoryConfidence as number | undefined) ?? null,
    targetProcName: (proc.targetProcName as string | undefined) ?? null,
    targetFile: (proc.targetFile as string | undefined) ?? null,
    targetWorkflowId: (proc.targetWorkflowId as string | undefined) ?? null,
    targetWorkflowName: (proc.targetWorkflowName as string | undefined) ?? null,
    label: (proc.label as string | undefined) ?? null,
    description: (proc.description as string | undefined) ?? null,
    flags,
    codegenApplied,
  };
}

export const migrationRouter = router({
  /** Liệt kê module YAML hiện có + tóm tắt. */
  listModules: rbacProcedure("edit", "settings").query(() => {
    const dir = MODULES_DIR();
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir).filter(
      (f) => f.endsWith(".yaml") && !f.startsWith("_") && !f.endsWith(".enriched.yaml"),
    );
    return files
      .map((f) => {
        const full = resolve(dir, f);
        try {
          const m = YAML.parse(readFileSync(full, "utf8")) as {
            module?: string;
            tables?: unknown[];
            procs?: unknown[];
            status?: { phase?: string };
          };
          const st = statSync(full);
          return {
            name: m.module ?? f.replace(/\.yaml$/, ""),
            phase: m.status?.phase ?? "discovered",
            tableCount: m.tables?.length ?? 0,
            procCount: m.procs?.length ?? 0,
            updatedAt: st.mtime.toISOString(),
          };
        } catch {
          return null;
        }
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
  }),

  /** Đọc full manifest của 1 module. */
  getModule: rbacProcedure("edit", "settings")
    .input(z.object({ name: moduleNameSchema }))
    .query(({ input }) => {
      const p = resolve(MODULES_DIR(), `${input.name}.yaml`);
      if (!existsSync(p)) return null;
      const enrichedPath = p.replace(/\.yaml$/, ".enriched.yaml");
      return {
        manifest: YAML.parse(readFileSync(p, "utf8")) as unknown,
        enrichedManifest: existsSync(enrichedPath)
          ? (YAML.parse(readFileSync(enrichedPath, "utf8")) as unknown)
          : null,
      };
    }),

  /** Đọc raw text YAML — cho diff viewer bên FE. */
  getModuleYaml: rbacProcedure("edit", "settings")
    .input(
      z.object({ name: moduleNameSchema, variant: z.enum(["main", "enriched"]).default("main") }),
    )
    .query(({ input }) => {
      const suffix = input.variant === "enriched" ? ".enriched.yaml" : ".yaml";
      const p = resolve(MODULES_DIR(), `${input.name}${suffix}`);
      if (!existsSync(p)) return null;
      return readFileSync(p, "utf8");
    }),

  /** Khởi tạo 1 job migration (discover/enrich/...). */
  startJob: rbacProcedure("edit", "settings")
    .input(
      z.object({
        action: z.enum(ACTION_VALUES),
        module: moduleNameSchema,
        args: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Phase R: action "generate" đã triển khai (batch codegen). "audit" vẫn
      // chưa — dùng auditModuleDryRun + saveAuditReport per-module.
      if (input.action === "audit") {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message: `Action "audit" thuộc Tier 4 — dùng auditModuleDryRun + saveAuditReport thay vì batch job.`,
        });
      }
      const jobId = await enqueueMigrationJob({
        action: input.action,
        module: input.module,
        args: input.args,
        userId: ctx.user.id,
        companyId: ctx.user.companyId,
      });
      return { jobId };
    }),

  /** Polling fallback. WS channel migration:<userId> là chính. */
  jobStatus: rbacProcedure("edit", "settings")
    .input(z.object({ jobId: z.string() }))
    .query(async ({ ctx, input }) => {
      return getMigrationJobStatus(input.jobId, ctx.user.companyId);
    }),

  /** Liệt kê action job durable của company (discover/enrich/generate/data).
   *  Dùng cho panel "Tác vụ nền": xem trạng thái + resume job lỗi. */
  listJobs: rbacProcedure("edit", "settings")
    .input(
      z
        .object({
          module: z.string().optional(),
          statuses: z
            .array(z.enum(["queued", "running", "completed", "failed", "canceled"]))
            .optional(),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: migrationJobs.id,
          action: migrationJobs.action,
          module: migrationJobs.module,
          status: migrationJobs.status,
          attempts: migrationJobs.attempts,
          message: migrationJobs.message,
          error: migrationJobs.error,
          startedAt: migrationJobs.startedAt,
          completedAt: migrationJobs.completedAt,
          durationMs: migrationJobs.durationMs,
          createdAt: migrationJobs.createdAt,
          updatedAt: migrationJobs.updatedAt,
        })
        .from(migrationJobs)
        .where(
          and(
            eq(migrationJobs.companyId, ctx.user.companyId),
            input?.module ? eq(migrationJobs.module, input.module) : undefined,
          ),
        )
        .orderBy(desc(migrationJobs.createdAt))
        .limit(input?.limit ?? 50);
      return input?.statuses?.length
        ? rows.filter((r) => input.statuses!.includes(r.status as (typeof input.statuses)[number]))
        : rows;
    }),

  /** Resume 1 action job lỗi/queued — re-enqueue cùng args (idempotent:
   *  skipExisting/skipEnriched/merge bỏ qua phần đã xong). */
  resumeJob: rbacProcedure("edit", "settings")
    .input(z.object({ jobId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [job] = await ctx.db
        .select({ id: migrationJobs.id, status: migrationJobs.status })
        .from(migrationJobs)
        .where(
          and(eq(migrationJobs.id, input.jobId), eq(migrationJobs.companyId, ctx.user.companyId)),
        );
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job không tồn tại." });
      }
      if (job.status === "running") {
        throw new TRPCError({ code: "CONFLICT", message: "Job đang chạy — không resume được." });
      }
      await resumeMigrationJob(job.id);
      return { jobId: job.id, status: "queued" as const };
    }),

  /** Huỷ 1 action job đang chờ/lỗi. Job đang queued sẽ bị worker bỏ qua
   *  khi tới lượt (check status=canceled). Không abort job đang chạy. */
  cancelJob: rbacProcedure("edit", "settings")
    .input(z.object({ jobId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Cho phép huỷ cả job ĐANG CHẠY: worker check status='canceled' ở ranh
      // giới mỗi item (cooperative stop) → dừng giữa chừng, không ghi đè
      // completed. queued thì worker bỏ khi tới lượt.
      const [job] = await ctx.db
        .update(migrationJobs)
        .set({ status: "canceled", updatedAt: new Date() })
        .where(
          and(
            eq(migrationJobs.id, input.jobId),
            eq(migrationJobs.companyId, ctx.user.companyId),
            sql`${migrationJobs.status} in ('queued','running','failed')`,
          ),
        )
        .returning({ id: migrationJobs.id });
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job không tồn tại hoặc đã xong — không huỷ được.",
        });
      }
      return { jobId: job.id, status: "canceled" as const };
    }),

  /** Liệt kê ai-log entry của module. */
  aiLog: rbacProcedure("edit", "settings")
    .input(z.object({ module: moduleNameSchema }))
    .query(({ input }) => {
      const dir = resolve(AI_LOG_DIR(), input.module);
      if (!existsSync(dir)) return [];
      const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
      return files
        .map((f) => {
          const full = resolve(dir, f);
          const st = statSync(full);
          // Filename: <phase>-<timestamp>.json
          const m = f.match(/^(.+)-(.+)\.json$/);
          return {
            file: f,
            phase: m?.[1] ?? f,
            timestamp: m?.[2] ?? "",
            sizeBytes: st.size,
          };
        })
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    }),

  /** Đọc 1 ai-log entry (prompt + response). */
  getAiLogEntry: rbacProcedure("edit", "settings")
    .input(z.object({ module: moduleNameSchema, file: z.string() }))
    .query(({ input }) => {
      // Anti path traversal: file phải đuôi .json và không có dấu /.
      if (!input.file.endsWith(".json") || input.file.includes("/") || input.file.includes("\\")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Tham số file không hợp lệ." });
      }
      const p = resolve(AI_LOG_DIR(), input.module, input.file);
      if (!existsSync(p)) return null;
      // Đảm bảo path nằm trong AI_LOG_DIR (+ sep tránh prefix-match partial dir).
      if (!dirname(p).startsWith(AI_LOG_DIR() + sep)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Path không hợp lệ." });
      }
      return JSON.parse(readFileSync(p, "utf8")) as unknown;
    }),

  /** Preview 1 bảng MSSQL — columns metadata + 5 sample rows. Lazy
   *  load khi user expand row trong UI Discover. */
  previewTable: rbacProcedure("edit", "settings")
    .input(
      z.object({
        tableName: z.string().min(1), // schema.table
        samples: z.number().int().min(0).max(50).default(5),
      }),
    )
    .query(async ({ ctx, input }) => {
      const client = await openDefaultMssql(ctx.db, ctx.user.companyId);
      try {
        const [schema, name] = input.tableName.includes(".")
          ? input.tableName.split(".")
          : ["dbo", input.tableName];
        const info = await client.getTable(schema!, name!);
        const rows =
          input.samples > 0 ? await client.bulkRead(input.tableName, { limit: input.samples }) : [];
        return { tableName: input.tableName, info, samples: rows };
      } finally {
        await client.close();
      }
    }),

  /** AI normalize: phân tích toàn cục manifest → suggest renames để
   *  consistent. KHÔNG apply tự động; UI hiện preview + user chọn apply
   *  qua applyChange (cascade tự động). */
  normalizeNamesAi: rbacProcedure("edit", "settings")
    .input(z.object({ module: moduleNameSchema }))
    .mutation(async ({ ctx, input }) => {
      return await normalizeNames({
        module: input.module,
        companyId: ctx.user.companyId,
      });
    }),

  /** Refresh manifest: re-discover từ MSSQL với cùng seed/exclude của
   *  lần discover trước (lưu trong manifest.discoverParams), MERGE vào
   *  manifest hiện tại — giữ enrichment (label, kind, mapTo, targetProcName).
   *  Trả diff (tables/cols/procs added/removed) để user review. */
  refreshManifest: rbacProcedure("edit", "settings")
    .input(z.object({ name: moduleNameSchema }))
    .mutation(async ({ ctx, input }) => {
      const p = resolve(MODULES_DIR(), `${input.name}.yaml`);
      if (!existsSync(p)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Manifest không tồn tại." });
      }
      const current = YAML.parse(readFileSync(p, "utf8")) as {
        discoverParams?: {
          seedTables: string[];
          excludeTables: string[];
          maxTables: number;
          seedProcs?: string[];
        };
      };
      const params = current.discoverParams;
      if (!params) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Manifest cũ chưa có discoverParams (tạo trước khi feature refresh) — chạy 'discover' lại để lưu params.",
        });
      }
      const client = await openDefaultMssql(ctx.db, ctx.user.companyId);
      try {
        await runDiscover({
          name: input.name,
          seedTables: params.seedTables,
          excludeTables: params.excludeTables,
          maxTables: params.maxTables,
          // Giữ proc-centric khi refresh module cockpit.
          seedProcs: params.seedProcs,
          mssqlClient: client,
          merge: true,
        });
      } finally {
        await client.close();
      }
      // Đọc lại manifest sau khi runDiscover ghi (có lastRefresh diff).
      const refreshed = YAML.parse(readFileSync(p, "utf8")) as {
        lastRefresh?: {
          at: string;
          tablesAdded: string[];
          tablesRemoved: string[];
          procsAdded: string[];
          procsRemoved: string[];
          columnsAdded: Array<{ table: string; column: string }>;
          columnsRemoved: Array<{ table: string; column: string }>;
        };
      };
      return (
        refreshed.lastRefresh ?? {
          at: new Date().toISOString(),
          tablesAdded: [],
          tablesRemoved: [],
          procsAdded: [],
          procsRemoved: [],
          columnsAdded: [],
          columnsRemoved: [],
        }
      );
    }),

  /** Diagram: trả nodes (entity/enum) + edges (FK qua inferredRelations).
   *  Dùng cho UI xyflow render sơ đồ liên kết. */
  getDiagram: rbacProcedure("edit", "settings")
    .input(z.object({ name: moduleNameSchema }))
    .query(({ input }) => {
      const p = resolve(MODULES_DIR(), `${input.name}.yaml`);
      if (!existsSync(p)) return { nodes: [], edges: [] };
      const m = YAML.parse(readFileSync(p, "utf8")) as {
        tables?: Array<{
          name: string;
          suggestedEntityName?: string;
          suggestedKind?: "entity" | "enum";
          label?: string;
          columns?: unknown[];
          inferredRelations?: Array<{ column: string; refTable: string; refColumn: string }>;
          enumOptions?: string[];
        }>;
      };
      const tables = m.tables ?? [];
      const nodes = tables.map((t) => ({
        id: t.name,
        kind: (t.suggestedKind ?? "entity") as "entity" | "enum",
        entityName: t.suggestedEntityName ?? t.name,
        label: t.label ?? t.suggestedEntityName ?? t.name,
        fieldCount: t.columns?.length ?? 0,
        enumValueCount: t.enumOptions?.length ?? 0,
      }));
      const tableNames = new Set(tables.map((t) => t.name.toLowerCase()));
      const edges: Array<{
        id: string;
        source: string;
        target: string;
        column: string;
        refColumn: string;
      }> = [];
      for (const t of tables) {
        for (const r of t.inferredRelations ?? []) {
          // Bỏ edge trỏ ra bảng ngoài module (cross-module edges hiện riêng).
          if (!tableNames.has(r.refTable.toLowerCase())) continue;
          // Tìm match name canonical.
          const refMatch = tables.find((x) => x.name.toLowerCase() === r.refTable.toLowerCase());
          if (!refMatch) continue;
          edges.push({
            id: `${t.name}.${r.column}->${refMatch.name}.${r.refColumn}`,
            source: t.name,
            target: refMatch.name,
            column: r.column,
            refColumn: r.refColumn,
          });
        }
      }
      return { nodes, edges };
    }),

  /** Apply 1 thay đổi lên manifest + cascade các tham chiếu liên quan.
   *  Action:
   *   - renameEntity: đổi suggestedEntityName của 1 bảng; cập nhật
   *     relationEntity của các cột FK trỏ tới (ở bảng khác trong manifest).
   *   - changeKind:   đổi suggestedKind giữa entity ↔ enum; cập nhật
   *     entityType các cột FK trỏ tới (relation → enum khi target thành enum).
   *   - renameField:  đổi mapTo.field của 1 cột (không cascade FK column gốc — đó là tên cột MSSQL).
   */
  applyChange: rbacProcedure("edit", "settings")
    .input(
      z.object({
        module: moduleNameSchema,
        action: z.discriminatedUnion("type", [
          z.object({
            type: z.literal("renameEntity"),
            tableName: z.string(),
            newName: z.string().regex(/^[a-z][a-z0-9_]*$/),
          }),
          z.object({
            type: z.literal("changeKind"),
            tableName: z.string(),
            newKind: z.enum(["entity", "enum"]),
          }),
          z.object({
            type: z.literal("renameField"),
            tableName: z.string(),
            columnName: z.string(),
            newField: z.string().regex(/^[a-z][a-z0-9_]*$/),
          }),
        ]),
      }),
    )
    .mutation(({ input, ctx }) => {
      const p = resolve(MODULES_DIR(), `${input.module}.yaml`);
      if (!existsSync(p)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Manifest không tồn tại." });
      }
      const m = YAML.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
      const tables = (m.tables as Array<Record<string, unknown>> | undefined) ?? [];
      const changes: string[] = [];

      const findTable = (name: string) =>
        tables.find((t) => String(t.name).toLowerCase() === name.toLowerCase());

      if (input.action.type === "renameEntity") {
        const tbl = findTable(input.action.tableName);
        if (!tbl)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Bảng ${input.action.tableName} không có.`,
          });
        const old = String(tbl.suggestedEntityName ?? "");
        tbl.suggestedEntityName = input.action.newName;
        changes.push(`Đổi entity name "${old}" → "${input.action.newName}" cho ${tbl.name}`);
        // Cascade: relationEntity của FK columns trong các bảng khác.
        for (const other of tables) {
          const cols = (other.columns as Array<Record<string, unknown>> | undefined) ?? [];
          for (const c of cols) {
            const mapTo = c.mapTo as Record<string, unknown> | undefined;
            if (mapTo && mapTo.relationEntity === old) {
              mapTo.relationEntity = input.action.newName;
              changes.push(`  ↳ cascade ${other.name}.${c.name}.mapTo.relationEntity`);
            }
          }
        }
      } else if (input.action.type === "changeKind") {
        const tbl = findTable(input.action.tableName);
        if (!tbl)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Bảng ${input.action.tableName} không có.`,
          });
        const oldKind = String(tbl.suggestedKind ?? "entity");
        const newKind = input.action.newKind;
        if (oldKind === newKind) {
          return { changes: ["(không đổi — kind đã đúng)"] };
        }
        tbl.suggestedKind = newKind;
        if (newKind === "entity") delete tbl.enumOptions;
        changes.push(`Đổi kind ${tbl.name}: "${oldKind}" → "${newKind}"`);
        // Cascade: cột FK ở bảng khác trỏ tới tbl → đổi entityType.
        const targetEntityName = String(tbl.suggestedEntityName ?? "");
        for (const other of tables) {
          const cols = (other.columns as Array<Record<string, unknown>> | undefined) ?? [];
          for (const c of cols) {
            const mapTo = c.mapTo as Record<string, unknown> | undefined;
            if (!mapTo || mapTo.relationEntity !== targetEntityName) continue;
            if (newKind === "enum") {
              mapTo.entityType = "enum";
              changes.push(`  ↳ ${other.name}.${c.name}.mapTo.entityType: relation → enum`);
            } else {
              mapTo.entityType = "relation";
              changes.push(`  ↳ ${other.name}.${c.name}.mapTo.entityType: enum → relation`);
            }
          }
        }
      } else if (input.action.type === "renameField") {
        const act = input.action; // capture để narrow stick trong arrow.
        const tbl = findTable(act.tableName);
        if (!tbl)
          throw new TRPCError({ code: "NOT_FOUND", message: `Bảng ${act.tableName} không có.` });
        const cols = (tbl.columns as Array<Record<string, unknown>> | undefined) ?? [];
        const col = cols.find((c) => String(c.name).toLowerCase() === act.columnName.toLowerCase());
        if (!col)
          throw new TRPCError({ code: "NOT_FOUND", message: `Cột ${act.columnName} không có.` });
        const mapTo = (col.mapTo ?? {}) as Record<string, unknown>;
        const old = String(mapTo.field ?? "");
        mapTo.field = act.newField;
        col.mapTo = mapTo;
        changes.push(`Đổi field "${old}" → "${act.newField}" cho ${tbl.name}.${act.columnName}`);
      }

      writeFileSync(p, YAML.stringify(m, { lineWidth: 0 }), "utf8");
      // Decision log — shared cross-module để module sau biết và auto-apply.
      appendDecision({
        module: input.module,
        action: input.action,
        by: ctx.user.id,
        changes,
      });
      return { changes };
    }),

  /** Liệt kê decisions cho 1 bảng MSSQL — UI hiện history khi user
   *  duyệt module mới, biết bảng này đã được quyết định gì ở module khác. */
  decisionsForTable: rbacProcedure("edit", "settings")
    .input(z.object({ tableName: z.string() }))
    .query(({ input }) => readDecisionsForTable(input.tableName)),

  /** Tier 4: AI audit module — đọc manifest + procedures (DB) + plugin
   *  files + golden stats → sinh Markdown checklist các điểm hoàn thiện
   *  trước cutover. Sync, không ghi gì; UI confirm rồi save qua endpoint
   *  saveAuditReport. */
  auditModuleDryRun: rbacProcedure("edit", "settings")
    .input(z.object({ module: moduleNameSchema }))
    .mutation(async ({ ctx, input }) => {
      const p = resolve(MODULES_DIR(), `${input.module}.yaml`);
      if (!existsSync(p)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Manifest không tồn tại." });
      }
      const manifest = YAML.parse(readFileSync(p, "utf8")) as Record<string, unknown>;

      // Tải procedures applied (per-company).
      const dbProcs = await ctx.db
        .select({
          name: procedures.name,
          label: procedures.label,
          description: procedures.description,
          paramsSchema: procedures.paramsSchema,
          code: procedures.code,
        })
        .from(procedures)
        .where(eq(procedures.companyId, ctx.user.companyId));

      // Tải plugin files (theo manifest.procs[].targetFile tier D).
      // Chỉ cho phép đọc file nằm trong pluginDir để chặn path traversal.
      const procs = (manifest.procs as Array<{ targetFile?: string }> | undefined) ?? [];
      const plugins: Array<{ fileName: string; code: string }> = [];
      const allowedPluginBase = pluginsRoot();
      for (const proc of procs) {
        if (!proc.targetFile) continue;
        const fullPath = resolve(repoRoot(), proc.targetFile);
        if (!fullPath.startsWith(allowedPluginBase + sep)) continue;
        if (existsSync(fullPath)) {
          try {
            plugins.push({
              fileName: proc.targetFile,
              code: readFileSync(fullPath, "utf8"),
            });
          } catch {
            /* skip */
          }
        }
      }

      // Đọc golden stats từ filesystem.
      const goldenDir = resolve(process.cwd(), "e2e", "golden", input.module);
      const goldenStats: Array<{
        procName: string;
        total: number;
        ok: number;
        failed: number;
        hasGoldenFile: boolean;
      }> = [];
      for (const proc of procs as Array<{ name: string }>) {
        const safeProc = proc.name.replace(/\W/g, "_");
        const goldenFile = resolve(goldenDir, `${safeProc}.json`);
        if (existsSync(goldenFile)) {
          try {
            const data = JSON.parse(readFileSync(goldenFile, "utf8")) as {
              cases?: Array<{ result?: { ok?: boolean } }>;
            };
            const cases = data.cases ?? [];
            const ok = cases.filter((c) => c.result?.ok === true).length;
            goldenStats.push({
              procName: proc.name,
              total: cases.length,
              ok,
              failed: cases.length - ok,
              hasGoldenFile: true,
            });
          } catch {
            goldenStats.push({
              procName: proc.name,
              total: 0,
              ok: 0,
              failed: 0,
              hasGoldenFile: true,
            });
          }
        } else {
          goldenStats.push({
            procName: proc.name,
            total: 0,
            ok: 0,
            failed: 0,
            hasGoldenFile: false,
          });
        }
      }

      return await auditModule({
        module: input.module,
        input: {
          module: input.module,
          manifest,
          procedures: dbProcs,
          plugins,
          goldenStats,
        },
        companyId: ctx.user.companyId,
      });
    }),

  /** Lưu audit report vào migration-plan/audit/<module>.md. */
  saveAuditReport: rbacProcedure("edit", "settings")
    .input(
      z.object({
        module: moduleNameSchema,
        markdown: z.string().min(1),
      }),
    )
    .mutation(({ input, ctx }) => {
      const auditDir = resolve(MIGRATION_ROOT(), "audit");
      mkdirSync(auditDir, { recursive: true });
      const file = resolve(auditDir, `${input.module}.md`);
      writeFileSync(file, input.markdown, "utf8");
      appendDecision({
        module: input.module,
        action: { type: "saveAuditReport", length: input.markdown.length },
        by: ctx.user.id,
      });
      return { filePath: file, length: input.markdown.length };
    }),

  /** Đọc audit report hiện có (nếu user đã save trước). */
  getAuditReport: rbacProcedure("edit", "settings")
    .input(z.object({ module: moduleNameSchema }))
    .query(({ input }) => {
      const file = resolve(MIGRATION_ROOT(), "audit", `${input.module}.md`);
      if (!existsSync(file)) return null;
      const st = statSync(file);
      return {
        filePath: file,
        markdown: readFileSync(file, "utf8"),
        updatedAt: st.mtime.toISOString(),
        sizeBytes: st.size,
      };
    }),

  /** Review status: compute realtime trạng thái migration của module —
   *  per proc/table {enriched, codegenApplied, goldenCaptured, ...}.
   *  Đọc từ manifest + bảng procedures (tier B) + bảng enums (enum) +
   *  filesystem (file plugin TS tier D + file golden). */
  getReviewStatus: rbacProcedure("edit", "settings")
    .input(z.object({ module: moduleNameSchema }))
    .query(async ({ ctx, input }) => {
      const p = resolve(MODULES_DIR(), `${input.module}.yaml`);
      if (!existsSync(p)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Manifest không tồn tại." });
      }
      const m = YAML.parse(readFileSync(p, "utf8")) as {
        module: string;
        status?: { phase?: string };
        tables?: Array<{
          name: string;
          suggestedEntityName?: string;
          suggestedKind?: "entity" | "enum";
          label?: string;
          description?: string;
          enumOptions?: string[];
        }>;
        procs?: Array<{
          name: string;
          suggestedTier?: string;
          targetProcName?: string;
          targetFile?: string;
          label?: string;
          description?: string;
          active?: boolean;
          verifiedAt?: string;
        }>;
      };

      const hasVnLabel = (item: { label?: string; description?: string }): boolean => {
        if (item.description && item.description.length > 0) return true;
        if (item.label && /[^\x00-\x7F]/.test(item.label)) return true;
        return false;
      };

      // Tải procedures + enums của company (1 query mỗi loại).
      const dbProcs = await ctx.db
        .select({ name: procedures.name, id: procedures.id })
        .from(procedures)
        .where(eq(procedures.companyId, ctx.user.companyId));
      const dbProcMap = new Map(dbProcs.map((r) => [r.name.toLowerCase(), r.id]));

      const dbEnums = await ctx.db
        .select({ name: enums.name, id: enums.id })
        .from(enums)
        .where(eq(enums.companyId, ctx.user.companyId));
      const dbEnumMap = new Map(dbEnums.map((r) => [r.name.toLowerCase(), r.id]));

      const goldenDir = resolve(process.cwd(), "e2e", "golden", input.module);

      // Process tables.
      const tables = (m.tables ?? []).map((t) => {
        const enriched = hasVnLabel(t);
        const kind = t.suggestedKind ?? "entity";
        let enumMaterialized = false;
        let enumId: string | null = null;
        if (kind === "enum" && t.suggestedEntityName) {
          enumId = dbEnumMap.get(t.suggestedEntityName.toLowerCase()) ?? null;
          enumMaterialized = !!enumId;
        }
        return {
          name: t.name,
          entityName: t.suggestedEntityName,
          kind,
          label: t.label,
          enriched,
          enumMaterialized,
          enumId,
        };
      });

      // Process procs.
      const procs = (m.procs ?? []).map((proc) => {
        const enriched = hasVnLabel(proc);
        const tier = proc.suggestedTier ?? "B";

        let codegenApplied = false;
        let codegenTarget: string | null = null;
        if (tier === "B" && proc.targetProcName) {
          const procId = dbProcMap.get(proc.targetProcName.toLowerCase());
          if (procId) {
            codegenApplied = true;
            codegenTarget = procId;
          }
        } else if (tier === "D" && proc.targetFile) {
          const filePath = resolve(repoRoot(), proc.targetFile);
          if (existsSync(filePath)) {
            codegenApplied = true;
            codegenTarget = proc.targetFile;
          }
        }

        const safeProc = proc.name.replace(/\W/g, "_");
        const goldenFile = resolve(goldenDir, `${safeProc}.json`);
        const goldenCaptured = existsSync(goldenFile);

        return {
          name: proc.name,
          targetProcName: proc.targetProcName,
          targetFile: proc.targetFile,
          tier,
          label: proc.label,
          enriched,
          codegenApplied,
          codegenTarget,
          goldenCaptured,
          active: proc.active !== false,
          verified: !!proc.verifiedAt, // Phase A: golden-replay đã pass
        };
      });

      const stats = {
        tables: {
          total: tables.length,
          enriched: tables.filter((t) => t.enriched).length,
          enumTotal: tables.filter((t) => t.kind === "enum").length,
          enumMaterialized: tables.filter((t) => t.kind === "enum" && t.enumMaterialized).length,
        },
        procs: {
          total: procs.length,
          enriched: procs.filter((p) => p.enriched).length,
          codegenApplied: procs.filter((p) => p.codegenApplied).length,
          goldenCaptured: procs.filter((p) => p.goldenCaptured).length,
          verified: procs.filter((p) => p.verified).length,
          tierC: procs.filter((p) => p.tier === "C").length,
          // Proc active đã codegen nhưng CHƯA verify golden — Phase C gate dùng.
          unverifiedActive: procs.filter(
            (p) => p.active && p.tier !== "C" && p.tier !== "A" && p.codegenApplied && !p.verified,
          ).length,
        },
      };

      return {
        module: m.module,
        phase: m.status?.phase ?? "discovered",
        tables,
        procs,
        stats,
      };
    }),

  /** Kết thúc module: chuyển phase sang "live" + ghi cutoverAt.
   *  GATE (Phase C): chặn nếu còn proc active đã codegen NHƯNG chưa verify
   *  golden (verifiedAt rỗng). Bỏ qua gate bằng force=true + reason (ghi
   *  decisions để truy nguồn quyết định nhận nợ). */
  finalizeModule: rbacProcedure("edit", "settings")
    .input(
      z.object({
        module: moduleNameSchema,
        force: z.boolean().default(false),
        reason: z.string().optional(),
      }),
    )
    .mutation(({ input, ctx }) => {
      const p = resolve(MODULES_DIR(), `${input.module}.yaml`);
      if (!existsSync(p)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Manifest không tồn tại." });
      }
      const m = YAML.parse(readFileSync(p, "utf8")) as Record<string, unknown>;

      // Gate verify: proc active, không phải Tier A/C, đã có target (codegen)
      // nhưng thiếu verifiedAt → chưa chứng minh khớp golden.
      const procs = (m.procs as Array<Record<string, unknown>> | undefined) ?? [];
      const unverified = procs.filter(
        (pr) =>
          pr.active !== false &&
          pr.suggestedTier !== "A" &&
          pr.suggestedTier !== "C" &&
          (pr.targetProcName || pr.targetFile) &&
          !pr.verifiedAt,
      );
      if (unverified.length > 0 && !input.force) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            `${unverified.length} proc active đã codegen nhưng CHƯA verify golden: ` +
            `${unverified
              .slice(0, 8)
              .map((pr) => pr.name)
              .join(", ")}${unverified.length > 8 ? "…" : ""}. ` +
            `Chạy verifyProc/verifyModuleProcs trước, hoặc finalize với force=true + reason để nhận nợ.`,
        });
      }
      if (input.force && unverified.length > 0 && !input.reason?.trim()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "force=true khi còn proc chưa verify thì BẮT BUỘC có reason (ghi audit).",
        });
      }

      const status = (m.status as Record<string, unknown> | undefined) ?? {};
      status.phase = "live";
      status.cutoverAt = new Date().toISOString();
      status.cutoverBy = ctx.user.id;
      m.status = status;
      writeFileSync(p, YAML.stringify(m, { lineWidth: 0 }), "utf8");
      appendDecision({
        module: input.module,
        action: {
          type: "finalizeModule",
          force: input.force,
          unverifiedProcs: unverified.length,
          reason: input.reason,
        },
        by: ctx.user.id,
      });
      return {
        ok: true,
        phase: "live" as const,
        cutoverAt: status.cutoverAt as string,
        unverifiedProcs: unverified.length,
      };
    }),

  /** Rollback finalize → phase=filled. */
  unfinalizeModule: rbacProcedure("edit", "settings")
    .input(z.object({ module: moduleNameSchema }))
    .mutation(({ input, ctx }) => {
      const p = resolve(MODULES_DIR(), `${input.module}.yaml`);
      if (!existsSync(p)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Manifest không tồn tại." });
      }
      const m = YAML.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
      const status = (m.status as Record<string, unknown> | undefined) ?? {};
      status.phase = "filled";
      delete status.cutoverAt;
      delete status.cutoverBy;
      m.status = status;
      writeFileSync(p, YAML.stringify(m, { lineWidth: 0 }), "utf8");
      appendDecision({
        module: input.module,
        action: { type: "unfinalizeModule" },
        by: ctx.user.id,
      });
      return { ok: true, phase: "filled" as const };
    }),

  /** Thêm bảng vào excludeTables của manifest + xoá khỏi tables hiện tại.
   *  Bảng excluded sẽ không bị BFS lan vào ở refresh tới. Cũng xoá các
   *  inferredRelations của bảng khác trỏ tới bảng bị exclude (FK orphan). */
  addToExclude: rbacProcedure("edit", "settings")
    .input(
      z.object({
        module: moduleNameSchema,
        tableNames: z.array(z.string().min(1)).min(1),
      }),
    )
    .mutation(({ input, ctx }) => {
      const p = resolve(MODULES_DIR(), `${input.module}.yaml`);
      if (!existsSync(p)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Manifest không tồn tại." });
      }
      const m = YAML.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
      const excludeSet = new Set(input.tableNames.map((t) => t.toLowerCase()));

      // Update discoverParams.excludeTables (union với cũ).
      const dp = (m.discoverParams as { excludeTables?: string[] } | undefined) ?? {};
      const oldExclude = new Set((dp.excludeTables ?? []).map((t) => t.toLowerCase()));
      for (const t of excludeSet) oldExclude.add(t);
      (m.discoverParams as Record<string, unknown>) = {
        ...(dp as Record<string, unknown>),
        excludeTables: [...oldExclude].sort(),
      };

      // Remove khỏi tables[] hiện tại.
      const tables = (m.tables as Array<{ name: string }> | undefined) ?? [];
      const removedTables: string[] = [];
      m.tables = tables.filter((t) => {
        if (excludeSet.has(t.name.toLowerCase())) {
          removedTables.push(t.name);
          return false;
        }
        return true;
      });

      // Dọn inferredRelations của bảng khác trỏ tới bảng bị exclude.
      let removedRels = 0;
      for (const t of m.tables as Array<Record<string, unknown>>) {
        const rels = (t.inferredRelations as Array<{ refTable: string }> | undefined) ?? [];
        const beforeLen = rels.length;
        t.inferredRelations = rels.filter((r) => !excludeSet.has(r.refTable.toLowerCase()));
        removedRels += beforeLen - (t.inferredRelations as unknown[]).length;
      }

      // Dọn procs có reads/writes thuần là bảng exclude (proc còn ý nghĩa khi
      // ít nhất 1 bảng đọc/ghi vẫn còn trong module).
      const procs = (m.procs as Array<Record<string, unknown>> | undefined) ?? [];
      const removedProcs: string[] = [];
      m.procs = procs.filter((proc) => {
        const reads = (proc.reads as string[] | undefined) ?? [];
        const writes = (proc.writes as string[] | undefined) ?? [];
        const all = [...reads, ...writes];
        if (all.length === 0) return true;
        const allExcluded = all.every((t) => excludeSet.has(t.toLowerCase()));
        if (allExcluded) {
          removedProcs.push(String(proc.name));
          return false;
        }
        return true;
      });

      writeFileSync(p, YAML.stringify(m, { lineWidth: 0 }), "utf8");
      appendDecision({
        module: input.module,
        action: { type: "addToExclude", tableNames: input.tableNames },
        by: ctx.user.id,
      });
      return {
        addedToExclude: input.tableNames,
        removedTables,
        removedRels,
        removedProcs,
      };
    }),

  /** Bỏ bảng khỏi excludeTables (cho phép lại — refresh tới sẽ BFS vào). */
  removeFromExclude: rbacProcedure("edit", "settings")
    .input(
      z.object({
        module: moduleNameSchema,
        tableNames: z.array(z.string().min(1)).min(1),
      }),
    )
    .mutation(({ input, ctx }) => {
      const p = resolve(MODULES_DIR(), `${input.module}.yaml`);
      if (!existsSync(p)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Manifest không tồn tại." });
      }
      const m = YAML.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
      const dp = (m.discoverParams as { excludeTables?: string[] } | undefined) ?? {};
      const removeSet = new Set(input.tableNames.map((t) => t.toLowerCase()));
      const newExclude = (dp.excludeTables ?? []).filter((t) => !removeSet.has(t.toLowerCase()));
      (m.discoverParams as Record<string, unknown>) = {
        ...(dp as Record<string, unknown>),
        excludeTables: newExclude,
      };
      writeFileSync(p, YAML.stringify(m, { lineWidth: 0 }), "utf8");
      appendDecision({
        module: input.module,
        action: { type: "removeFromExclude", tableNames: input.tableNames },
        by: ctx.user.id,
      });
      return { removed: input.tableNames, currentExclude: newExclude };
    }),

  /** Cấu hình split-enum rules cho 1 bảng (kind=enum). Replace toàn
   *  bộ splitEnums[] của bảng đó. Mảng rỗng → tắt split mode. */
  setSplitEnums: rbacProcedure("edit", "settings")
    .input(
      z.object({
        module: moduleNameSchema,
        tableName: z.string(),
        splitEnums: z.array(
          z.object({
            discriminatorColumn: z.string().min(1),
            discriminatorValue: z.string().min(1),
            name: z.string().regex(/^[a-z][a-z0-9_]*$/),
            label: z.string().min(1),
            description: z.string().optional(),
            valueColumn: z.string().optional(),
            labelColumn: z.string().optional(),
            extraColumns: z.array(z.string()).optional(),
          }),
        ),
      }),
    )
    .mutation(({ input, ctx }) => {
      const p = resolve(MODULES_DIR(), `${input.module}.yaml`);
      if (!existsSync(p)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Manifest không tồn tại." });
      }
      const m = YAML.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
      const tables = (m.tables as Array<Record<string, unknown>> | undefined) ?? [];
      const tbl = tables.find(
        (t) => String(t.name).toLowerCase() === input.tableName.toLowerCase(),
      );
      if (!tbl) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Bảng "${input.tableName}" không có.` });
      }
      if (tbl.suggestedKind !== "enum") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Bảng "${input.tableName}" không phải kind=enum.`,
        });
      }
      if (input.splitEnums.length === 0) {
        delete tbl.splitEnums;
      } else {
        tbl.splitEnums = input.splitEnums;
      }
      writeFileSync(p, YAML.stringify(m, { lineWidth: 0 }), "utf8");
      appendDecision({
        module: input.module,
        action: {
          type: "setSplitEnums",
          tableName: input.tableName,
          count: input.splitEnums.length,
        },
        by: ctx.user.id,
      });
      return { count: input.splitEnums.length };
    }),

  /** Materialize 1 bảng enum thành record `enums` trong hệ thống.
   *  Đọc data thật từ MSSQL → build values[{value,label,...extra}] →
   *  upsert qua bảng `enums` (per-company). Hỗ trợ:
   *  - Single enum (mặc định): cả bảng là 1 enum.
   *  - Split enum: nếu bảng có splitEnums[] trong manifest → sinh N enum
   *    theo discriminator (vd 1 bảng DM_HE_THONG → trang_thai_don,
   *    loai_thanh_toan, ...).
   *  - Extra props: extraColumns[] → mỗi value gắn metadata cột thêm. */
  materializeEnum: rbacProcedure("edit", "enum")
    .input(
      z.object({
        module: moduleNameSchema,
        tableName: z.string().min(1),
        /** Override cột làm `value`. Default: primary key. */
        valueColumn: z.string().optional(),
        /** Override cột làm `label`. Default: cột text có name/ten/label/mo_ta. */
        labelColumn: z.string().optional(),
        /** Extra columns lưu vào metadata mỗi value. */
        extraColumns: z.array(z.string()).optional(),
        /** Max rows đọc từ MSSQL — enum không nên quá nhiều. */
        limit: z.number().int().min(1).max(5000).default(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const manifestFile = resolve(MODULES_DIR(), `${input.module}.yaml`);
      if (!existsSync(manifestFile)) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Manifest module "${input.module}" không tồn tại.`,
        });
      }
      const manifest = YAML.parse(readFileSync(manifestFile, "utf8")) as {
        tables?: Array<{
          name: string;
          suggestedEntityName?: string;
          suggestedKind?: "entity" | "enum";
          label?: string;
          description?: string;
          primaryKey?: string[];
          columns?: Array<{ name: string; type: string }>;
          splitEnums?: Array<{
            discriminatorColumn: string;
            discriminatorValue: string;
            name: string;
            label: string;
            description?: string;
            valueColumn?: string;
            labelColumn?: string;
            extraColumns?: string[];
          }>;
        }>;
      };
      const tbl = manifest.tables?.find(
        (t) => t.name.toLowerCase() === input.tableName.toLowerCase(),
      );
      if (!tbl) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Bảng "${input.tableName}" không có trong manifest.`,
        });
      }
      if (tbl.suggestedKind !== "enum") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Bảng "${input.tableName}" có suggestedKind="${tbl.suggestedKind ?? "entity"}" — không phải enum. Chạy enrich AI để gán kind, hoặc sửa manifest tay.`,
        });
      }

      const client = await openDefaultMssql(ctx.db, ctx.user.companyId);
      try {
        // Split mode: nếu manifest có splitEnums[] → sinh N enum riêng.
        if (tbl.splitEnums && tbl.splitEnums.length > 0) {
          const results: Array<Awaited<ReturnType<typeof materializeOneEnum>>> = [];
          for (const split of tbl.splitEnums) {
            const r = await materializeOneEnum({
              db: ctx.db,
              companyId: ctx.user.companyId,
              userId: ctx.user.id,
              client,
              table: tbl,
              splitRule: split,
              valueColumn: split.valueColumn,
              labelColumn: split.labelColumn,
              extraColumns: split.extraColumns,
              limit: input.limit,
              enumName: split.name,
              enumLabel: split.label,
              description: split.description ?? tbl.description,
            });
            results.push(r);
          }
          return { mode: "split" as const, results };
        }

        // Single mode (default).
        const r = await materializeOneEnum({
          db: ctx.db,
          companyId: ctx.user.companyId,
          userId: ctx.user.id,
          client,
          table: tbl,
          valueColumn: input.valueColumn,
          labelColumn: input.labelColumn,
          extraColumns: input.extraColumns,
          limit: input.limit,
          enumName: tbl.suggestedEntityName ?? input.tableName.split(".").pop()!.toLowerCase(),
          enumLabel: tbl.label ?? tbl.suggestedEntityName ?? input.tableName,
          description: tbl.description,
        });
        return { mode: "single" as const, ...r };
      } finally {
        await client.close();
      }
    }),

  /** Tier 3: AI sinh sample input cho 1 proc — đọc paramsSchema MSSQL +
   *  5 sample data cho mỗi bảng đọc → 10 input variants
   *  (happy/boundary/edge). KHÔNG ghi gì, chỉ preview. */
  generateSamplesDryRun: rbacProcedure("edit", "settings")
    .input(
      z.object({
        module: moduleNameSchema,
        procName: z.string().min(1),
        sampleRowsPerTable: z.number().int().min(1).max(20).default(5),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = await openDefaultMssql(ctx.db, ctx.user.companyId);
      try {
        return await generateProcSamples({
          module: input.module,
          procName: input.procName,
          mssqlClient: client,
          companyId: ctx.user.companyId,
          sampleRowsPerTable: input.sampleRowsPerTable,
        });
      } finally {
        await client.close();
      }
    }),

  /** Tier 3: capture golden baseline — chạy proc MSSQL với từng sample,
   *  lưu output vào e2e/golden/<module>/<proc>.json. Connection cần
   *  allowWrite=true (execProc bị chặn ở read-only mode). */
  captureGolden: rbacProcedure("edit", "settings")
    .input(
      z.object({
        module: moduleNameSchema,
        procName: z.string().min(1),
        samples: z.array(
          z.object({
            name: z.string(),
            kind: z.enum(["happy", "boundary", "edge"]),
            description: z.string().optional(),
            args: z.record(z.string(), z.unknown()),
            expectedError: z.string().optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = await openDefaultMssql(ctx.db, ctx.user.companyId);
      const results: Array<{
        name: string;
        kind: ProcSample["kind"];
        ok: boolean;
        output?: unknown;
        error?: string;
        durationMs: number;
      }> = [];
      try {
        for (const s of input.samples) {
          const t0 = Date.now();
          try {
            const rows = await client.execProc(input.procName, s.args);
            results.push({
              name: s.name,
              kind: s.kind,
              ok: true,
              output: rows,
              durationMs: Date.now() - t0,
            });
          } catch (e) {
            results.push({
              name: s.name,
              kind: s.kind,
              ok: false,
              error: (e as Error).message,
              durationMs: Date.now() - t0,
            });
          }
        }
      } finally {
        await client.close();
      }

      // Ghi vào e2e/golden/<module>/<procName>.json
      const goldenDir = resolve(process.cwd(), "e2e", "golden", input.module);
      mkdirSync(goldenDir, { recursive: true });
      const safeFile = input.procName.replace(/\W/g, "_") + ".json";
      const file = resolve(goldenDir, safeFile);
      const payload = {
        procName: input.procName,
        capturedAt: new Date().toISOString(),
        cases: input.samples.map((s, i) => ({
          name: s.name,
          kind: s.kind,
          description: s.description,
          input: s.args,
          expectedError: s.expectedError,
          result: results[i]
            ? {
                ok: results[i]!.ok,
                output: results[i]!.output,
                error: results[i]!.error,
                durationMs: results[i]!.durationMs,
              }
            : null,
        })),
      };
      writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
      appendDecision({
        module: input.module,
        action: {
          type: "captureGolden",
          procName: input.procName,
          sampleCount: input.samples.length,
          successCount: results.filter((r) => r.ok).length,
        },
        by: ctx.user.id,
      });
      return {
        filePath: file,
        total: results.length,
        ok: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      };
    }),

  /** Tier 2 codegen — dry-run: AI dịch T-SQL → JS (tier B) hoặc TS
   *  (tier D). Trả CODE PREVIEW, KHÔNG save. UI confirm xong gọi
   *  codegenProcApply. */
  codegenProcDryRun: rbacProcedure("edit", "settings")
    .input(
      z.object({
        module: moduleNameSchema,
        procName: z.string().min(1),
        connectionId: z.string().uuid().optional(),
        /** Vòng verify golden: diff lần sinh trước để AI tự sửa logic cho khớp
         *  baseline (lấy từ verifyProc.feedback). */
        feedback: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = input.connectionId
        ? await openMssqlById(ctx.db, ctx.user.companyId, input.connectionId)
        : await openDefaultMssql(ctx.db, ctx.user.companyId);
      try {
        return await codegenProc({
          module: input.module,
          procName: input.procName,
          mssqlClient: client,
          companyId: ctx.user.companyId,
          feedback: input.feedback,
        });
      } finally {
        await client.close();
      }
    }),

  /** Tier 2 codegen — apply:
   *  - tier B: upsert vào bảng `procedures` (per-company) qua tRPC pattern
   *    của procedures.save.
   *  - tier D: ghi file TS vào `packages/plugins/module-<module>/<file>.ts`
   *    (tạo thư mục nếu chưa có). Caller có thể `overwrite: true` để đè.
   *  procName (optional): nếu cung cấp → update manifest YAML targetProcName/targetFile
   *    sau khi apply thành công (nhất quán với Tier C workflow apply).
   */
  codegenProcApply: rbacProcedure("edit", "settings")
    .input(
      z.object({
        module: moduleNameSchema,
        tier: z.enum(["B", "D"]),
        /** Tên proc trong manifest (schema.name). Nếu có → update manifest YAML sau apply. */
        procName: z.string().optional(),
        // Tier B fields:
        name: z
          .string()
          .regex(/^[a-z][a-z0-9_]*$/)
          .optional(),
        label: z.string().optional(),
        description: z.string().optional(),
        paramsSchema: z.array(z.record(z.string(), z.unknown())).optional(),
        code: z.string().min(1),
        // Tier D fields:
        fileName: z.string().optional(),
        overwrite: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      /** Helper: update targetProcName hoặc targetFile trong manifest YAML. */
      function updateManifestTarget(field: "targetProcName" | "targetFile", value: string) {
        if (!input.procName) return;
        const manifestPath = resolve(MODULES_DIR(), `${input.module}.yaml`);
        if (!existsSync(manifestPath)) return;
        try {
          const m = YAML.parse(readFileSync(manifestPath, "utf8")) as {
            procs?: Array<Record<string, unknown>>;
          };
          const proc = (m.procs ?? []).find(
            (p) => String(p.name).toLowerCase() === input.procName!.toLowerCase(),
          );
          if (proc) {
            proc[field] = value;
            writeFileSync(manifestPath, YAML.stringify(m, { lineWidth: 0 }), "utf8");
          }
        } catch {
          /* skip nếu manifest parse fail */
        }
      }

      if (input.tier === "B") {
        if (!input.name || !input.label) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Tier B cần name + label" });
        }
        const [existing] = await ctx.db
          .select({ id: procedures.id, meta: procedures.meta })
          .from(procedures)
          .where(
            and(eq(procedures.companyId, ctx.user.companyId), eq(procedures.name, input.name)),
          );
        const values = {
          label: input.label,
          description: input.description ?? null,
          paramsSchema: (input.paramsSchema ?? []) as unknown[],
          code: input.code,
          updatedAt: new Date(),
        };
        // Nguồn gốc migrate: ghi meta.source để truy ngược proc mới → proc
        // MSSQL cũ. Chỉ lưu khi biết procName gốc (manifest schema.name).
        const sourceMeta = input.procName
          ? {
              kind: "migration" as const,
              sourceProc: input.procName,
              module: input.module,
              tier: "B" as const,
              migratedAt: new Date().toISOString(),
              migratedBy: ctx.user.id,
            }
          : null;
        if (existing) {
          const updateValues = sourceMeta
            ? {
                ...values,
                meta: {
                  ...((existing.meta as Record<string, unknown> | null) ?? {}),
                  source: sourceMeta,
                },
              }
            : values;
          await ctx.db.update(procedures).set(updateValues).where(eq(procedures.id, existing.id));
          updateManifestTarget("targetProcName", input.name);
          appendDecision({
            module: input.module,
            action: {
              type: "codegenProcApply",
              tier: "B",
              procName: input.procName,
              name: input.name,
            },
            by: ctx.user.id,
          });
          return {
            tier: "B" as const,
            procedureId: existing.id,
            upserted: "updated" as const,
            name: input.name,
          };
        }
        const [row] = await ctx.db
          .insert(procedures)
          .values({
            companyId: ctx.user.companyId,
            name: input.name,
            createdBy: ctx.user.id,
            ...values,
            ...(sourceMeta ? { meta: { source: sourceMeta } } : {}),
          })
          .returning({ id: procedures.id });
        if (!row)
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Insert procedure fail." });
        updateManifestTarget("targetProcName", input.name);
        appendDecision({
          module: input.module,
          action: {
            type: "codegenProcApply",
            tier: "B",
            procName: input.procName,
            name: input.name,
          },
          by: ctx.user.id,
        });
        return {
          tier: "B" as const,
          procedureId: row.id,
          upserted: "created" as const,
          name: input.name,
        };
      }

      // Tier D — ghi file plugin.
      if (!input.fileName) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Tier D cần fileName" });
      }
      // Anti path traversal: chỉ basename .ts.
      if (
        input.fileName.includes("/") ||
        input.fileName.includes("\\") ||
        !input.fileName.endsWith(".ts")
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "fileName phải là basename *.ts không có /.",
        });
      }
      const pluginDir = pluginModuleDir(input.module);
      mkdirSync(pluginDir, { recursive: true });
      const target = resolve(pluginDir, input.fileName);
      // Safety: target phải nằm trong pluginDir (+ sep tránh prefix-match partial dir).
      if (!target.startsWith(pluginDir + sep)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Path không hợp lệ." });
      }
      // Validate cú pháp cơ bản — chặn code LLM hỏng (truncate/markdown/mất cân
      // bằng {}) ghi vào plugin làm vỡ build cả workspace.
      const synErr = validateGeneratedTs(input.code);
      if (synErr) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Code Tier D không hợp lệ (${synErr}) — không ghi file. Sinh lại codegen.`,
        });
      }
      const fileExists = existsSync(target);
      if (fileExists && !input.overwrite) {
        return {
          tier: "D" as const,
          filePath: target,
          upserted: "conflict" as const,
          message: "File đã tồn tại. Truyền overwrite=true để đè.",
        };
      }
      // Nhúng header truy nguồn vào đầu file plugin để truy ngược file TS →
      // proc MSSQL cũ ngay trong code. Marker @migrated-from cũng chống nhân
      // đôi header khi overwrite (code mới từ LLM không chứa marker này).
      const body =
        input.procName && !input.code.startsWith("// @migrated-from:")
          ? `// @migrated-from: ${input.procName}\n` +
            `// @module: ${input.module} | @tier: D | @migratedAt: ${new Date().toISOString()}\n` +
            "// Sinh tự động từ stored procedure MSSQL — chạy lại codegen để cập nhật.\n\n" +
            input.code
          : input.code;
      writeFileSync(target, body, "utf8");
      // Lưu relative path (slash-separated) để cross-platform safe.
      const relPath = target.replace(repoRoot() + sep, "").replace(/\\/g, "/");
      updateManifestTarget("targetFile", relPath);
      appendDecision({
        module: input.module,
        action: {
          type: "codegenProcApply",
          tier: "D",
          procName: input.procName,
          fileName: input.fileName,
        },
        by: ctx.user.id,
      });
      // Nạp lại registry để file vừa ghi gọi được ngay qua invokeModuleProc
      // (không cần restart). Lỗi refresh không nên làm hỏng apply → bỏ qua.
      await refreshModuleProcs().catch(() => {});
      return {
        tier: "D" as const,
        filePath: target,
        upserted: fileExists ? ("overwritten" as const) : ("created" as const),
      };
    }),

  /** Phase A — Verify proc đã migrate so với golden baseline: chạy proc
   *  (Tier B/D) với từng input golden, so output (key-insensitive multiset).
   *  Trả pass/fail + diff + feedback (nhúng vào codegenProcDryRun.feedback để
   *  AI tự sửa). Đánh dấu manifest verifiedAt khi 100% case pass. */
  verifyProc: rbacProcedure("edit", "settings")
    .input(z.object({ module: moduleNameSchema, procName: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const r = await verifyProcAgainstGolden({
        db: ctx.db,
        companyId: ctx.user.companyId,
        module: input.module,
        procName: input.procName,
        actorUserId: ctx.user.id,
      });
      // Ghi/xoá verifiedAt trong manifest theo kết quả → Phase C gate đọc được.
      const mp = resolve(MODULES_DIR(), `${input.module}.yaml`);
      if (existsSync(mp)) {
        try {
          const m = YAML.parse(readFileSync(mp, "utf8")) as {
            procs?: Array<Record<string, unknown>>;
          };
          const proc = (m.procs ?? []).find(
            (p) => String(p.name).toLowerCase() === input.procName.toLowerCase(),
          );
          if (proc) {
            if (r.verified) proc.verifiedAt = new Date().toISOString();
            else delete proc.verifiedAt;
            writeFileSync(mp, YAML.stringify(m, { lineWidth: 0 }), "utf8");
          }
        } catch {
          /* manifest parse fail — skip, verify result vẫn trả về */
        }
      }
      appendDecision({
        module: input.module,
        action: {
          type: "verifyProc",
          procName: input.procName,
          verified: r.verified,
          passedCases: r.passedCases,
          totalCases: r.totalCases,
        },
        by: ctx.user.id,
      });
      return r;
    }),

  /** Phase A — Verify hàng loạt: mọi proc active có golden + đã generate.
   *  Trả tổng hợp + danh sách proc chưa verified (để Review/gate). */
  verifyModuleProcs: rbacProcedure("edit", "settings")
    .input(z.object({ module: moduleNameSchema }))
    .mutation(async ({ ctx, input }) => {
      const mp = resolve(MODULES_DIR(), `${input.module}.yaml`);
      if (!existsSync(mp)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Manifest module không tồn tại." });
      }
      const m = YAML.parse(readFileSync(mp, "utf8")) as {
        procs?: Array<{
          name: string;
          active?: boolean;
          suggestedTier?: string;
          targetProcName?: string;
          targetFile?: string;
        }>;
      };
      // Chỉ verify proc active, không phải Tier C, đã generate (có target).
      const targets = (m.procs ?? []).filter(
        (p) =>
          p.active !== false &&
          p.suggestedTier !== "C" &&
          p.suggestedTier !== "A" &&
          (p.targetProcName || p.targetFile),
      );
      const results: Awaited<ReturnType<typeof verifyProcAgainstGolden>>[] = [];
      for (const p of targets) {
        results.push(
          await verifyProcAgainstGolden({
            db: ctx.db,
            companyId: ctx.user.companyId,
            module: input.module,
            procName: p.name,
            actorUserId: ctx.user.id,
          }),
        );
      }
      // Ghi verifiedAt cho proc pass (1 lần ghi file).
      try {
        for (const r of results) {
          const proc = (m.procs ?? []).find(
            (p) => p.name.toLowerCase() === r.procName.toLowerCase(),
          ) as Record<string, unknown> | undefined;
          if (!proc) continue;
          // Pass → ghi verifiedAt; FAIL → XOÁ verifiedAt cũ (nếu không, proc
          // từng pass rồi fail vẫn giữ verifiedAt → finalize gate bị bypass).
          if (r.verified) proc.verifiedAt = new Date().toISOString();
          else delete proc.verifiedAt;
        }
        writeFileSync(mp, YAML.stringify(m, { lineWidth: 0 }), "utf8");
      } catch {
        /* skip */
      }
      const verified = results.filter((r) => r.verified).length;
      const noGolden = results.filter((r) => r.error?.includes("golden")).length;
      return {
        module: input.module,
        total: results.length,
        verified,
        failed: results.length - verified,
        noGolden,
        procs: results.map((r) => ({
          procName: r.procName,
          tier: r.tier,
          verified: r.verified,
          passedCases: r.passedCases,
          totalCases: r.totalCases,
          error: r.error,
        })),
      };
    }),

  /** Dry-run enrich AI cho 1 proc — sync, trả output ngay (KHÔNG
   *  qua queue/poll). Dùng cho UI debug/test prompt. KHÔNG ghi
   *  enriched.yaml; chỉ log vào ai-log. */
  enrichProcDryRun: rbacProcedure("edit", "settings")
    .input(
      z.object({
        module: moduleNameSchema,
        procName: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = await openDefaultMssql(ctx.db, ctx.user.companyId);
      try {
        return await enrichOneProc({
          module: input.module,
          procName: input.procName,
          mssqlClient: client,
          companyId: ctx.user.companyId,
        });
      } finally {
        await client.close();
      }
    }),

  /** Preview body T-SQL của 1 stored procedure. */
  previewProc: rbacProcedure("edit", "settings")
    .input(z.object({ procName: z.string().min(1), connectionId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const client = input.connectionId
        ? await openMssqlById(ctx.db, ctx.user.companyId, input.connectionId)
        : await openDefaultMssql(ctx.db, ctx.user.companyId);
      try {
        const [schema, name] = input.procName.includes(".")
          ? input.procName.split(".")
          : ["dbo", input.procName];
        const proc = await client.getProc(schema!, name!);
        return { procName: input.procName, proc };
      } finally {
        await client.close();
      }
    }),

  /** Tìm proc theo NỘI DUNG body T-SQL (sys.sql_modules.definition LIKE).
   *  Trả danh sách "schema.name" khớp (cap 1000). Dùng cho ô "Tìm trong body"
   *  ở màn Migrate proc — bắt cả tên cột alias, EXEC proc khác, biến… mà lọc
   *  theo tên không thấy. */
  searchProcsByBody: rbacProcedure("edit", "settings")
    .input(
      z.object({ keyword: z.string().min(2).max(200), connectionId: z.string().uuid().optional() }),
    )
    .query(async ({ ctx, input }) => {
      const client = input.connectionId
        ? await openMssqlById(ctx.db, ctx.user.companyId, input.connectionId)
        : await openDefaultMssql(ctx.db, ctx.user.companyId);
      try {
        // Escape ký tự wildcard LIKE (\ % _ [) để khớp literal từ khoá.
        const kw = input.keyword.replace(/[\\%_[]/g, (c) => `\\${c}`);
        const rows = await client.query<{ proc: string }>(
          `SELECT TOP 1000 (s.name + '.' + o.name) AS proc
             FROM sys.sql_modules m
             JOIN sys.objects o ON o.object_id = m.object_id
             JOIN sys.schemas s ON s.schema_id = o.schema_id
            WHERE o.type = 'P'
              AND m.definition LIKE '%' + @kw + '%' ESCAPE '\\'
            ORDER BY s.name, o.name`,
          { kw },
        );
        return { keyword: input.keyword, matches: rows.map((r) => r.proc) };
      } finally {
        await client.close();
      }
    }),

  /* ── Phase Q — Pre-import live tables + defer dirty proc ─────── */

  /** Q1: Đọc sys.dm_exec_procedure_stats từ MSSQL → trả thống kê hoạt
   *  động proc. Kèm cờ `seenInAnyModule` để FE highlight proc đang trong
   *  manifest. Lưu ý: data chỉ có từ lần MSSQL restart gần nhất + plan
   *  còn trong cache — proc CHƯA gọi không có entry (có thể "dead" hoặc
   *  "evicted from cache"). */
  detectActiveProcs: rbacProcedure("edit", "settings").mutation(async ({ ctx }) => {
    const client = await openDefaultMssql(ctx.db, ctx.user.companyId);
    let stats: Awaited<ReturnType<typeof client.getProcStats>>;
    try {
      stats = await client.getProcStats();
    } finally {
      await client.close();
    }

    // Build set procs đã có trong manifest cross-module để FE phân biệt
    // "proc lạ" vs "proc thuộc manifest đã track".
    const knownProcs = new Set<string>();
    const dir = MODULES_DIR();
    if (existsSync(dir)) {
      const files = readdirSync(dir).filter(
        (f) => f.endsWith(".yaml") && !f.startsWith("_") && !f.endsWith(".enriched.yaml"),
      );
      for (const f of files) {
        try {
          const m = YAML.parse(readFileSync(resolve(dir, f), "utf8")) as {
            procs?: Array<{ name?: string }>;
          };
          for (const p of m.procs ?? []) {
            if (p.name) knownProcs.add(p.name.toLowerCase());
          }
        } catch {
          /* skip yaml hỏng */
        }
      }
    }

    return {
      readAt: new Date().toISOString(),
      total: stats.length,
      procs: stats.map((s) => {
        const fullName = `${s.schema}.${s.name}`;
        return {
          schema: s.schema,
          name: s.name,
          fullName,
          lastExecAt: s.lastExecAt,
          execCount: s.execCount,
          inManifest: knownProcs.has(fullName.toLowerCase()),
        };
      }),
    };
  }),

  /** Q1: Ghi kết quả detect vào manifest của 1 module — cập nhật field
   *  `active`/`lastExecAt`/`execCount`/`statsLastReadAt` cho mỗi proc.
   *  Input dùng `marks` để user override active (vd quyết định "proc này
   *  có trong stats nhưng nội bộ vẫn dùng tay → giữ active=true"). */
  markProcActivity: rbacProcedure("edit", "settings")
    .input(
      z.object({
        module: moduleNameSchema,
        readAt: z.string().min(1),
        marks: z.array(
          z.object({
            procName: z.string().min(1),
            active: z.boolean(),
            lastExecAt: z.string().nullable().optional(),
            execCount: z.number().int().min(0).optional(),
          }),
        ),
      }),
    )
    .mutation(({ ctx, input }) => {
      const p = resolve(MODULES_DIR(), `${input.module}.yaml`);
      if (!existsSync(p)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Manifest không tồn tại." });
      }
      const m = YAML.parse(readFileSync(p, "utf8")) as {
        procs?: Array<{
          name: string;
          active?: boolean;
          lastExecAt?: string | null;
          execCount?: number;
          statsLastReadAt?: string;
        }>;
      };
      const procs = m.procs ?? [];
      const updates: string[] = [];
      const byName = new Map(input.marks.map((mk) => [mk.procName.toLowerCase(), mk]));
      for (const proc of procs) {
        const mk = byName.get(proc.name.toLowerCase());
        if (!mk) continue;
        proc.active = mk.active;
        if (mk.lastExecAt !== undefined) proc.lastExecAt = mk.lastExecAt;
        if (mk.execCount !== undefined) proc.execCount = mk.execCount;
        proc.statsLastReadAt = input.readAt;
        updates.push(proc.name);
      }
      writeFileSync(p, YAML.stringify(m, { lineWidth: 0 }), "utf8");
      appendDecision({
        module: input.module,
        action: {
          type: "markProcActivity",
          readAt: input.readAt,
          updated: updates.length,
          marks: input.marks.map((mk) => ({
            procName: mk.procName,
            active: mk.active,
            execCount: mk.execCount,
          })),
        },
        by: ctx.user.id,
      });
      return { updated: updates.length, procs: updates };
    }),

  /** Q2: Tổng hợp cross-module — gom union reads∪writes của mọi proc
   *  active từ TẤT CẢ manifest. Bảng "dead" = trong manifest nhưng KHÔNG
   *  được active proc nào đụng (skip data migration). */
  getLiveTablesAcrossModules: rbacProcedure("edit", "settings").query(() => {
    const dir = MODULES_DIR();
    if (!existsSync(dir)) {
      return {
        modules: [],
        liveTables: [],
        deadTables: [],
        stats: {
          modulesScanned: 0,
          totalProcs: 0,
          activeProcs: 0,
          deadProcs: 0,
          unknownProcs: 0,
          totalTables: 0,
          liveTables: 0,
          deadTables: 0,
          migratedTables: 0,
        },
      };
    }
    // Phase S4: include `_quick-*.yaml` để bảng quick-migrated được tính
    // vào liveTables (touched bởi proc nào đó). Skip chỉ `_example.yaml`.
    const files = readdirSync(dir).filter(
      (f) => f.endsWith(".yaml") && !f.startsWith("_example") && !f.endsWith(".enriched.yaml"),
    );

    interface TableEntry {
      name: string;
      module: string;
      entityName?: string;
      label?: string;
      kind: "entity" | "enum";
      migratedAt?: string;
      touchedBy: string[]; // procs active đụng vào
    }
    const tableMap = new Map<string, TableEntry>(); // key = lowercase fullname
    let totalProcs = 0;
    let activeProcs = 0;
    let unknownProcs = 0; // chưa có field active
    const modulesScanned: string[] = [];

    for (const f of files) {
      try {
        const m = YAML.parse(readFileSync(resolve(dir, f), "utf8")) as {
          module?: string;
          tables?: Array<{
            name: string;
            suggestedEntityName?: string;
            suggestedKind?: "entity" | "enum";
            label?: string;
            migratedAt?: string;
          }>;
          procs?: Array<{
            name: string;
            active?: boolean;
            reads?: string[];
            writes?: string[];
          }>;
        };
        const moduleName = m.module ?? f.replace(/\.yaml$/, "");
        modulesScanned.push(moduleName);
        // Index bảng
        for (const t of m.tables ?? []) {
          const key = t.name.toLowerCase();
          if (!tableMap.has(key)) {
            tableMap.set(key, {
              name: t.name,
              module: moduleName,
              entityName: t.suggestedEntityName,
              label: t.label,
              kind: t.suggestedKind ?? "entity",
              migratedAt: t.migratedAt,
              touchedBy: [],
            });
          }
        }
        // Aggregate proc activity
        for (const p of m.procs ?? []) {
          totalProcs++;
          if (p.active === undefined) unknownProcs++;
          // Mặc định active=true nếu chưa có cờ (chưa chạy detect).
          const isActive = p.active !== false;
          if (!isActive) continue;
          activeProcs++;
          for (const tname of [...(p.reads ?? []), ...(p.writes ?? [])]) {
            const key = tname.toLowerCase();
            const entry = tableMap.get(key);
            if (entry) {
              if (!entry.touchedBy.includes(p.name)) entry.touchedBy.push(p.name);
            } else {
              // Bảng nằm ngoài tables[] (cross-module ref) — vẫn track.
              tableMap.set(key, {
                name: tname,
                module: "(external)",
                kind: "entity",
                touchedBy: [p.name],
              });
            }
          }
        }
      } catch {
        /* skip yaml hỏng */
      }
    }

    const allTables = Array.from(tableMap.values());
    const liveTables = allTables.filter((t) => t.touchedBy.length > 0);
    const deadTables = allTables.filter((t) => t.touchedBy.length === 0);
    const migratedTables = allTables.filter((t) => t.migratedAt).length;

    return {
      modules: modulesScanned.sort(),
      liveTables: liveTables.sort((a, b) => a.name.localeCompare(b.name)),
      deadTables: deadTables.sort((a, b) => a.name.localeCompare(b.name)),
      stats: {
        modulesScanned: modulesScanned.length,
        totalProcs,
        activeProcs,
        deadProcs: totalProcs - activeProcs - unknownProcs,
        unknownProcs,
        totalTables: allTables.length,
        liveTables: liveTables.length,
        deadTables: deadTables.length,
        migratedTables,
      },
    };
  }),

  /** Q3: Bulk ETL — chạy bulkRead MSSQL + upsert entity_records cho TẤT
   *  CẢ bảng được caller chọn. Mỗi bảng: resolve entity theo
   *  manifest.suggestedEntityName, tạo entity nếu chưa có, INSERT records.
   *  Cập nhật manifest.tables[i].migratedAt khi thành công. */
  bulkMigrateLiveTables: rbacProcedure("edit", "settings")
    .input(
      z.object({
        // Bảng schema.name. Caller phải tự chọn (FE đề xuất = liveTables).
        tableNames: z.array(z.string().min(1)).min(1).max(200),
        limitPerTable: z.number().int().min(1).max(100_000).default(10_000),
        dryRun: z.boolean().default(false),
        /** force=true → xoá tất cả entity_records hiện có của entity trước khi import.
         *  Mặc định false → INSERT thêm (caveat: có thể tạo duplicate). */
        force: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Index toàn bộ manifest để map tableName → (module, entityName, columns).
      const dir = MODULES_DIR();
      interface TableMeta {
        moduleName: string;
        modulePath: string;
        tableName: string;
        entityName: string;
        label?: string;
        columns: Array<{ name: string; mapTo?: { field: string; entityType?: string } }>;
        pkField?: string; // resolved mapped-field name for the primary key column
      }
      const tableMap = new Map<string, TableMeta>();
      if (existsSync(dir)) {
        // Phase S4: include `_quick-*.yaml` để bulkMigrateLiveTables resolve
        // được bảng do Quick Migrate đăng ký.
        const files = readdirSync(dir).filter(
          (f) => f.endsWith(".yaml") && !f.startsWith("_example") && !f.endsWith(".enriched.yaml"),
        );
        for (const f of files) {
          const full = resolve(dir, f);
          try {
            const m = YAML.parse(readFileSync(full, "utf8")) as {
              module?: string;
              tables?: Array<{
                name: string;
                suggestedEntityName?: string;
                suggestedKind?: "entity" | "enum";
                label?: string;
                primaryKey?: string[];
                columns?: Array<{ name: string; mapTo?: { field: string; entityType?: string } }>;
              }>;
            };
            const moduleName = m.module ?? f.replace(/\.yaml$/, "");
            for (const t of m.tables ?? []) {
              // Bỏ enum: Q3 chỉ migrate data entity, enum dùng materializeEnum.
              if (t.suggestedKind === "enum") continue;
              if (!t.suggestedEntityName) continue;
              // Derive pkField: resolve MSSQL column name → mapped field name.
              const rawPkCol = Array.isArray(t.primaryKey) ? t.primaryKey[0] : undefined;
              let pkField: string | undefined;
              if (rawPkCol) {
                const pkColDef = (t.columns ?? []).find(
                  (c) => c.name.toLowerCase() === rawPkCol.toLowerCase(),
                );
                pkField = pkColDef?.mapTo?.field ?? rawPkCol.toLowerCase();
              }
              tableMap.set(t.name.toLowerCase(), {
                moduleName,
                modulePath: full,
                tableName: t.name,
                entityName: t.suggestedEntityName,
                label: t.label,
                columns: t.columns ?? [],
                pkField,
              });
            }
          } catch (e) {
            console.error(
              `[bulkMigrateLiveTables] Cannot parse manifest ${full}:`,
              (e as Error).message,
            );
          }
        }
      }

      const client = await openDefaultMssql(ctx.db, ctx.user.companyId);
      const results: Array<{
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
      }> = [];

      // Phase T1: lookup default connection ID để ghi vào meta.source — cho
      // phép cleanup sau này biết entity migrate từ connection nào.
      const [defaultConn] = await ctx.db
        .select({ id: mssqlConnections.id })
        .from(mssqlConnections)
        .where(
          and(
            eq(mssqlConnections.companyId, ctx.user.companyId),
            eq(mssqlConnections.isDefault, true),
          ),
        )
        .limit(1);
      const defaultConnId = defaultConn?.id ?? null;

      try {
        // Group bảng theo manifest để batch update YAML 1 lần / module.
        const manifestUpdates = new Map<
          string,
          {
            path: string;
            stats: Map<
              string,
              {
                rowsRead: number;
                rowsUpserted: number;
                truncated: boolean;
                unmappedColumns: string[];
              }
            >;
          }
        >();

        for (const tn of input.tableNames) {
          const t0 = Date.now();
          const meta = tableMap.get(tn.toLowerCase());
          if (!meta) {
            results.push({
              tableName: tn,
              ok: false,
              skipped: "not-in-manifest",
              rowsRead: 0,
              rowsUpserted: 0,
              rowsUpdated: 0,
              rowsDeleted: 0,
              truncated: false,
              unmappedColumns: [],
              error: "Bảng không có trong manifest entity nào (có thể là enum hoặc external).",
              durationMs: Date.now() - t0,
            });
            continue;
          }

          try {
            // Resolve entity (tạo nếu chưa có) — chỉ khi !dryRun.
            let entityId: string | null = null;
            if (!input.dryRun) {
              // DEDUP theo BẢNG NGUỒN trước (tránh trùng entity khi module khác
              // đã migrate bảng này dưới tên khác).
              const bySource = await findMigratedEntityBySourceTable(
                ctx.db,
                ctx.user.companyId,
                meta.tableName,
              );
              const [existing] = bySource
                ? [{ id: bySource.id, meta: { source: { kind: "migration" } } }]
                : await ctx.db
                    .select({ id: entities.id, meta: entities.meta })
                    .from(entities)
                    .where(
                      and(
                        eq(entities.companyId, ctx.user.companyId),
                        eq(entities.name, meta.entityName),
                      ),
                    )
                    .limit(1);
              if (existing) {
                // Phase T1 guard: nếu entity tồn tại nhưng KHÔNG phải do migration tạo
                // → KHÔNG đè meta tay user; skip với cảnh báo.
                const existingMeta = existing.meta as { source?: { kind?: string } } | null;
                const sourceKind = existingMeta?.source?.kind;
                if (sourceKind && sourceKind !== "migration") {
                  results.push({
                    tableName: tn,
                    entityName: meta.entityName,
                    ok: false,
                    skipped: "manual-entity",
                    rowsRead: 0,
                    rowsUpserted: 0,
                    rowsUpdated: 0,
                    rowsDeleted: 0,
                    truncated: false,
                    unmappedColumns: [],
                    error: `Entity "${meta.entityName}" đã có (kind=${sourceKind}) — không đè entity do user tạo tay/seed.`,
                    durationMs: Date.now() - t0,
                  });
                  continue;
                }
                entityId = existing.id;
              } else {
                // Tạo entity mới từ manifest columns → fields.
                const fields = meta.columns.flatMap((c) =>
                  c.mapTo?.field
                    ? [
                        {
                          name: c.mapTo.field,
                          label: c.mapTo.field,
                          type: c.mapTo.entityType ?? "text",
                        },
                      ]
                    : [],
                );
                const [inserted] = await ctx.db
                  .insert(entities)
                  .values({
                    companyId: ctx.user.companyId,
                    name: meta.entityName,
                    label: meta.label ?? meta.entityName,
                    fields,
                    meta: {
                      source: {
                        kind: "migration",
                        connectionId: defaultConnId,
                        module: meta.moduleName,
                        mssqlTable: meta.tableName,
                        importedAt: new Date().toISOString(),
                        importedBy: ctx.user.id,
                        rowsLastImported: 0,
                      },
                    },
                  })
                  .returning({ id: entities.id });
                if (!inserted) {
                  throw new Error(`Insert entity "${meta.entityName}" trả về rỗng.`);
                }
                entityId = inserted.id;
              }
            }

            const rows = await client.bulkRead<Record<string, unknown>>(meta.tableName, {
              limit: input.limitPerTable,
            });
            const truncated = rows.length >= input.limitPerTable;

            // Map row MSSQL → entity record data (theo mapTo.field).
            const colMap = new Map<string, string>();
            for (const c of meta.columns) {
              if (c.mapTo?.field) colMap.set(c.name.toLowerCase(), c.mapTo.field);
            }
            const unmappedColSet = new Set<string>();
            const mapped = rows.map((r) => {
              const data: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(r)) {
                const lk = k.toLowerCase();
                const field = colMap.get(lk);
                if (field) {
                  data[field] = v;
                } else {
                  unmappedColSet.add(k);
                  data[lk] = v; // fallback: lowercase column name
                }
              }
              return data;
            });
            const unmappedColumns = [...unmappedColSet];

            let rowsUpserted = 0;
            let rowsUpdated = 0;
            let rowsDeleted = 0;
            if (!input.dryRun && entityId) {
              const eid = entityId;
              // HYBRID-aware: route bảng thật vs EAV theo meta.storage.
              const w = await writeMappedRows({
                db: ctx.db,
                companyId: ctx.user.companyId,
                userId: ctx.user.id,
                entityId: eid,
                mapped,
                pkField: meta.pkField,
                force: input.force,
              });
              rowsUpserted = w.rowsUpserted;
              rowsUpdated = w.rowsUpdated;
              rowsDeleted = w.rowsDeleted;

              // Phase T1: cập nhật meta.source.importedAt + rowsLastImported sau
              // mỗi lần migrate thành công — dùng cho UI hiển thị "lần migrate cuối".
              await mergeSourceMeta(ctx.db, eid, {
                kind: "migration",
                connectionId: defaultConnId,
                module: meta.moduleName,
                mssqlTable: meta.tableName,
                importedAt: new Date().toISOString(),
                importedBy: ctx.user.id,
                rowsLastImported: rowsUpserted + rowsUpdated,
              });

              // Lưu stats để batch update manifest cuối loop.
              let bucket = manifestUpdates.get(meta.modulePath);
              if (!bucket) {
                bucket = { path: meta.modulePath, stats: new Map() };
                manifestUpdates.set(meta.modulePath, bucket);
              }
              bucket.stats.set(meta.tableName.toLowerCase(), {
                rowsRead: rows.length,
                rowsUpserted: rowsUpserted + rowsUpdated,
                truncated,
                unmappedColumns,
              });
            }

            results.push({
              tableName: meta.tableName,
              entityName: meta.entityName,
              ok: true,
              rowsRead: rows.length,
              rowsUpserted,
              rowsUpdated,
              rowsDeleted,
              truncated,
              unmappedColumns,
              durationMs: Date.now() - t0,
            });
          } catch (e) {
            results.push({
              tableName: tn,
              entityName: meta.entityName,
              ok: false,
              rowsRead: 0,
              rowsUpserted: 0,
              rowsUpdated: 0,
              rowsDeleted: 0,
              truncated: false,
              unmappedColumns: [],
              error: (e as Error).message,
              durationMs: Date.now() - t0,
            });
          }
        }

        // Batch ghi manifest cuối — set migratedAt cho tables thành công.
        if (!input.dryRun) {
          const now = new Date().toISOString();
          for (const [path, bucket] of manifestUpdates) {
            try {
              const m = YAML.parse(readFileSync(path, "utf8")) as {
                tables?: Array<{
                  name: string;
                  migratedAt?: string;
                  migrateStats?: {
                    rowsRead: number;
                    rowsUpserted: number;
                    truncated: boolean;
                    unmappedColumns: string[];
                  };
                }>;
              };
              for (const t of m.tables ?? []) {
                const s = bucket.stats.get(t.name.toLowerCase());
                if (!s) continue;
                t.migratedAt = now;
                t.migrateStats = {
                  rowsRead: s.rowsRead,
                  rowsUpserted: s.rowsUpserted,
                  truncated: s.truncated,
                  unmappedColumns: s.unmappedColumns,
                };
              }
              writeFileSync(path, YAML.stringify(m, { lineWidth: 0 }), "utf8");
            } catch (e) {
              console.error(
                `[bulkMigrateLiveTables] Cannot write manifest ${path}:`,
                (e as Error).message,
              );
            }
          }
        }
      } finally {
        await client.close();
      }

      const successTables = results.filter((r) => r.ok).map((r) => r.tableName);
      appendDecision({
        module: "(cross-module)",
        action: {
          type: "bulkMigrateLiveTables",
          dryRun: input.dryRun,
          force: input.force,
          limitPerTable: input.limitPerTable,
          requested: input.tableNames.length,
          succeeded: successTables.length,
          failed: results.length - successTables.length,
          tables: successTables,
        },
        by: ctx.user.id,
      });

      return {
        dryRun: input.dryRun,
        total: results.length,
        succeeded: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        totalRowsRead: results.reduce((s, r) => s + r.rowsRead, 0),
        totalRowsUpserted: results.reduce((s, r) => s + r.rowsUpserted, 0),
        totalRowsUpdated: results.reduce((s, r) => s + r.rowsUpdated, 0),
        truncatedTables: results.filter((r) => r.ok && r.truncated).map((r) => r.tableName),
        results,
      };
    }),

  /** Q4: Check 1 proc đã đủ điều kiện codegen chưa — mọi bảng trong
   *  reads∪writes phải `migratedAt != null`. Trả `missingTables` + gợi ý
   *  hành động (codegen / wait / mark-inactive). */
  getProcMigrationStatus: rbacProcedure("edit", "settings")
    .input(z.object({ module: moduleNameSchema, procName: z.string().min(1) }))
    .query(({ input }) => {
      // Đọc proc từ manifest module được chỉ định.
      const p = resolve(MODULES_DIR(), `${input.module}.yaml`);
      if (!existsSync(p)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Manifest không tồn tại." });
      }
      const m = YAML.parse(readFileSync(p, "utf8")) as {
        procs?: Array<{
          name: string;
          active?: boolean;
          reads?: string[];
          writes?: string[];
        }>;
      };
      const proc = (m.procs ?? []).find(
        (x) => x.name.toLowerCase() === input.procName.toLowerCase(),
      );
      if (!proc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Proc không có trong manifest." });
      }

      // Build migrated-table set cross-module (table có migratedAt).
      const migrated = new Set<string>();
      const inAnyManifest = new Set<string>();
      const dir = MODULES_DIR();
      if (existsSync(dir)) {
        // Phase S4: include `_quick-*.yaml` để Q4 nhận bảng đã migrate qua
        // Quick Migrate path là "clean" — không block codegen.
        const files = readdirSync(dir).filter(
          (f) => f.endsWith(".yaml") && !f.startsWith("_example") && !f.endsWith(".enriched.yaml"),
        );
        for (const f of files) {
          try {
            const mm = YAML.parse(readFileSync(resolve(dir, f), "utf8")) as {
              tables?: Array<{
                name: string;
                migratedAt?: string;
                suggestedKind?: "entity" | "enum";
              }>;
            };
            for (const t of mm.tables ?? []) {
              const key = t.name.toLowerCase();
              inAnyManifest.add(key);
              // Enum được materialize qua materializeEnum, không qua bulk
              // migrate — nhưng nếu user đã materialize coi như "sạch".
              if (t.migratedAt) migrated.add(key);
              if (t.suggestedKind === "enum") migrated.add(key); // enum không cần data ETL
            }
          } catch {
            /* skip */
          }
        }
      }

      const touched = Array.from(new Set([...(proc.reads ?? []), ...(proc.writes ?? [])]));
      const missingTables: Array<{ table: string; reason: string }> = [];
      for (const t of touched) {
        const key = t.toLowerCase();
        if (migrated.has(key)) continue;
        const reason = inAnyManifest.has(key) ? "chưa migrate data" : "không trong manifest nào";
        missingTables.push({ table: t, reason });
      }

      const isActive = proc.active !== false;
      const isClean = missingTables.length === 0;
      let suggestedAction: "codegen" | "wait" | "mark-inactive";
      if (!isActive) suggestedAction = "mark-inactive";
      else if (isClean) suggestedAction = "codegen";
      else suggestedAction = "wait";

      return {
        procName: proc.name,
        active: isActive,
        isClean,
        canCodegen: isClean && isActive,
        missingTables,
        touchedTables: touched,
        suggestedAction,
      };
    }),

  /* ── Phase S — Quick migrate: chọn bảng MSSQL → ETL không cần module ── */

  /** S1: Liệt kê tất cả bảng từ 1 connection MSSQL — kèm rowCount approx
   *  để UI ưu tiên chọn bảng có data. RowCount lấy từ sys.partitions. */
  listConnectionTables: rbacProcedure("edit", "settings")
    .input(z.object({ connectionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const client = await openMssqlById(ctx.db, ctx.user.companyId, input.connectionId);
      try {
        const tables = await client.listTables();
        let rowCounts = new Map<string, number>();
        try {
          const counts = await client.query<{
            full: string;
            row_count: number;
          }>(`
            SELECT
              CONCAT(s.name, '.', t.name) AS [full],
              SUM(p.rows) AS row_count
            FROM sys.partitions p
            JOIN sys.tables t ON p.object_id = t.object_id
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            WHERE p.index_id IN (0, 1)
            GROUP BY s.name, t.name
          `);
          rowCounts = new Map(counts.map((c) => [c.full.toLowerCase(), c.row_count]));
        } catch {
          /* MSSQL deny VIEW SYS → fallback rowCount null */
        }
        return tables.map((t) => ({
          schema: t.schema,
          name: t.name,
          fullName: `${t.schema}.${t.name}`,
          rowCount: rowCounts.get(`${t.schema}.${t.name}`.toLowerCase()) ?? null,
        }));
      } finally {
        await client.close();
      }
    }),

  /** S1: Preview 1 bảng — columns + sample rows + suggested entity/fields
   *  để dialog Quick Migrate dùng. */
  previewQuickTable: rbacProcedure("edit", "settings")
    .input(
      z.object({
        connectionId: z.string().uuid(),
        tableName: z.string().min(1),
        samples: z.number().int().min(0).max(20).default(5),
      }),
    )
    .query(async ({ ctx, input }) => {
      const client = await openMssqlById(ctx.db, ctx.user.companyId, input.connectionId);
      try {
        const [schema, name] = input.tableName.includes(".")
          ? input.tableName.split(".")
          : ["dbo", input.tableName];
        const info = await client.getTable(schema ?? "dbo", name ?? input.tableName);
        if (!info) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Bảng "${input.tableName}" không tồn tại trong MSSQL.`,
          });
        }
        const rows =
          input.samples > 0 ? await client.bulkRead(input.tableName, { limit: input.samples }) : [];

        const mapType = (dt: string): string => {
          const t = dt.toLowerCase();
          if (/int|bigint|smallint|tinyint|decimal|numeric|money|float|real/.test(t))
            return "number";
          if (t === "bit") return "boolean";
          if (t === "date") return "date";
          if (/datetime|smalldatetime|datetimeoffset/.test(t)) return "datetime";
          if (/xml|json/.test(t)) return "json";
          return "text";
        };
        const slug = (s: string) =>
          s
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, "_")
            .replace(/^_+|_+$/g, "");
        return {
          tableName: input.tableName,
          info,
          samples: rows,
          suggested: {
            entityName: slug(info.name),
            label: info.name,
            fields: info.columns.map((c) => ({
              name: slug(c.name),
              label: c.name,
              type: mapType(c.dataType),
            })),
          },
        };
      } finally {
        await client.close();
      }
    }),

  /** S1: Bulk ETL nhiều bảng cùng lúc, kèm tuỳ chọn ghi manifest
   *  _quick-<connId>.yaml để Phase Q4 codegen guard nhận diện. */
  quickMigrateTables: rbacProcedure("edit", "settings")
    .input(
      z.object({
        connectionId: z.string().uuid(),
        items: z
          .array(
            z.object({
              tableName: z.string().min(1),
              entityName: z.string().regex(/^[a-z][a-z0-9_]*$/),
              label: z.string().min(1),
              fields: z.array(
                z.object({
                  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
                  label: z.string().min(1),
                  type: z.string().min(1),
                }),
              ),
              force: z.boolean().default(false),
              /** Tên field MSSQL PK (single col, lower-case theo fields.name).
               *  Nếu cung cấp → upsert theo PK (chống duplicate khi migrate lại).
               *  Nếu không → INSERT thẳng (legacy, có thể duplicate). */
              pkField: z.string().optional(),
            }),
          )
          .min(1)
          .max(100),
        limitPerTable: z.number().int().min(1).max(100_000).default(10_000),
        dryRun: z.boolean().default(false),
        writeManifest: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = await openMssqlById(ctx.db, ctx.user.companyId, input.connectionId);
      const moduleName = `_quick-${input.connectionId}`;
      const results: Array<{
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
      }> = [];

      try {
        for (const it of input.items) {
          const t0 = Date.now();
          try {
            let entityId: string | null = null;
            if (!input.dryRun) {
              // DEDUP theo BẢNG NGUỒN trước: bảng MSSQL này đã có entity
              // migration (dù tên khác do module khác) → tái dùng, tránh trùng.
              const bySource = await findMigratedEntityBySourceTable(
                ctx.db,
                ctx.user.companyId,
                it.tableName,
              );
              const [existing] = bySource
                ? [{ id: bySource.id, meta: { source: { kind: "migration" } } }]
                : await ctx.db
                    .select({ id: entities.id, meta: entities.meta })
                    .from(entities)
                    .where(
                      and(
                        eq(entities.companyId, ctx.user.companyId),
                        eq(entities.name, it.entityName),
                      ),
                    )
                    .limit(1);
              if (existing) {
                const sourceKind = (existing.meta as { source?: { kind?: string } } | null)?.source
                  ?.kind;
                if (sourceKind && sourceKind !== "migration") {
                  results.push({
                    tableName: it.tableName,
                    entityName: it.entityName,
                    ok: false,
                    skipped: "manual-entity",
                    rowsRead: 0,
                    rowsUpserted: 0,
                    rowsUpdated: 0,
                    rowsDeleted: 0,
                    truncated: false,
                    error: `Entity "${it.entityName}" đã có (kind=${sourceKind}) — không đè entity tay/seed.`,
                    durationMs: Date.now() - t0,
                  });
                  continue;
                }
                entityId = existing.id;
              } else {
                const [inserted] = await ctx.db
                  .insert(entities)
                  .values({
                    companyId: ctx.user.companyId,
                    name: it.entityName,
                    label: it.label,
                    fields: it.fields,
                    meta: {
                      source: {
                        kind: "migration",
                        connectionId: input.connectionId,
                        module: moduleName,
                        mssqlTable: it.tableName,
                        importedAt: new Date().toISOString(),
                        importedBy: ctx.user.id,
                        rowsLastImported: 0,
                      },
                    },
                  })
                  .returning({ id: entities.id });
                if (!inserted) {
                  throw new Error(`Insert entity "${it.entityName}" trả về rỗng.`);
                }
                entityId = inserted.id;
              }
            }

            const rows = await client.bulkRead<Record<string, unknown>>(it.tableName, {
              limit: input.limitPerTable,
            });
            const truncated = rows.length >= input.limitPerTable;

            const fieldNames = new Set(it.fields.map((f) => f.name.toLowerCase()));
            const mapped = rows.map((r) => {
              const data: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(r)) {
                const key = k.toLowerCase();
                if (fieldNames.size === 0 || fieldNames.has(key)) {
                  data[key] = v;
                }
              }
              return data;
            });

            let rowsUpserted = 0;
            let rowsUpdated = 0;
            let rowsDeleted = 0;
            if (!input.dryRun && entityId) {
              const eid = entityId;
              // HYBRID-aware: route bảng thật vs EAV theo meta.storage.
              const w = await writeMappedRows({
                db: ctx.db,
                companyId: ctx.user.companyId,
                userId: ctx.user.id,
                entityId: eid,
                mapped,
                pkField: it.pkField,
                force: it.force,
              });
              rowsUpserted = w.rowsUpserted;
              rowsUpdated = w.rowsUpdated;
              rowsDeleted = w.rowsDeleted;

              await mergeSourceMeta(ctx.db, eid, {
                kind: "migration",
                connectionId: input.connectionId,
                module: moduleName,
                mssqlTable: it.tableName,
                importedAt: new Date().toISOString(),
                importedBy: ctx.user.id,
                rowsLastImported: rowsUpserted + rowsUpdated,
              });
            }

            results.push({
              tableName: it.tableName,
              entityName: it.entityName,
              ok: true,
              rowsRead: rows.length,
              rowsUpserted,
              rowsUpdated,
              rowsDeleted,
              truncated,
              durationMs: Date.now() - t0,
            });
          } catch (e) {
            results.push({
              tableName: it.tableName,
              entityName: it.entityName,
              ok: false,
              rowsRead: 0,
              rowsUpserted: 0,
              rowsUpdated: 0,
              rowsDeleted: 0,
              truncated: false,
              error: (e as Error).message,
              durationMs: Date.now() - t0,
            });
          }
        }
      } finally {
        await client.close();
      }

      // Ghi manifest _quick-<connId>.yaml để Q4 codegen guard nhận diện.
      if (!input.dryRun && input.writeManifest) {
        const p = resolve(MODULES_DIR(), `${moduleName}.yaml`);
        mkdirSync(dirname(p), { recursive: true });
        let existing: {
          module?: string;
          connectionRef?: string;
          tables?: Array<{
            name: string;
            suggestedEntityName?: string;
            label?: string;
            columns?: Array<unknown>;
            migratedAt?: string;
            migrateStats?: Record<string, unknown>;
          }>;
          procs?: unknown[];
          crossModuleEdges?: unknown[];
          status?: Record<string, unknown>;
        } = {};
        if (existsSync(p)) {
          try {
            existing = YAML.parse(readFileSync(p, "utf8")) as typeof existing;
          } catch {
            /* file hỏng → ghi lại từ đầu */
          }
        }
        existing.module = moduleName;
        existing.connectionRef = input.connectionId;
        existing.procs = [];
        existing.crossModuleEdges = [];
        existing.status = {
          phase: "live",
          capturedGoldenAt: null,
          scaffoldedAt: null,
          cutoverAt: new Date().toISOString(),
          retiredAt: null,
        };
        const tableMap = new Map<string, NonNullable<typeof existing.tables>[number]>();
        for (const t of existing.tables ?? []) tableMap.set(t.name.toLowerCase(), t);
        for (let i = 0; i < input.items.length; i++) {
          const it = input.items[i];
          const r = results[i];
          if (!it || !r?.ok) continue;
          tableMap.set(it.tableName.toLowerCase(), {
            name: it.tableName,
            suggestedEntityName: it.entityName,
            label: it.label,
            columns: it.fields.map((f) => ({
              name: f.name,
              type: f.type,
              mapTo: { field: f.name, entityType: f.type },
            })),
            migratedAt: new Date().toISOString(),
            migrateStats: {
              rowsRead: r.rowsRead,
              rowsUpserted: r.rowsUpserted,
              errors: 0,
            },
          });
        }
        existing.tables = Array.from(tableMap.values()).sort((a, b) =>
          a.name.localeCompare(b.name),
        );
        writeFileSync(p, YAML.stringify(existing, { lineWidth: 0 }), "utf8");
      }

      appendDecision({
        module: moduleName,
        action: {
          type: "quickMigrateTables",
          dryRun: input.dryRun,
          connectionId: input.connectionId,
          itemCount: input.items.length,
          succeeded: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
        },
        by: ctx.user.id,
      });

      return {
        dryRun: input.dryRun,
        connectionId: input.connectionId,
        moduleName,
        total: results.length,
        succeeded: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        totalRowsRead: results.reduce((s, r) => s + r.rowsRead, 0),
        totalRowsUpserted: results.reduce((s, r) => s + r.rowsUpserted, 0),
        totalRowsUpdated: results.reduce((s, r) => s + r.rowsUpdated, 0),
        results,
      };
    }),

  /* ── Phase U — Full import (queue + resume + sync) ──────── */

  /** U4: Tạo job full-import. Items = bảng đã chọn (như Quick). Worker
   *  stream import theo PK; resume tự nếu lỗi mạng. */
  startFullImport: rbacProcedure("edit", "settings")
    .input(
      z.object({
        connectionId: z.string().uuid(),
        items: z
          .array(
            z.object({
              tableName: z.string().min(1),
              entityName: z.string().regex(/^[a-z][a-z0-9_]*$/),
              label: z.string().min(1),
              fields: z.array(
                z.object({
                  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
                  label: z.string().min(1),
                  type: z.string().min(1),
                }),
              ),
            }),
          )
          .min(1)
          .max(200),
        batchSize: z.number().int().min(100).max(50_000).default(5_000),
        writeManifest: z.boolean().default(true),
        // 'table' = import THẲNG vào bảng thật (tên DB cũ) — cần ERP_HYBRID_TABLES=1.
        targetTier: z.enum(["eav", "table"]).default("eav"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Tạo job record + per-table records (prepare detect PK).
      const [job] = await ctx.db
        .insert(migrationFullJobs)
        .values({
          companyId: ctx.user.companyId,
          connectionId: input.connectionId,
          kind: "full",
          status: "queued",
          config: {
            items: input.items,
            batchSize: input.batchSize,
            writeManifest: input.writeManifest,
            targetTier: input.targetTier,
          },
          totalTables: input.items.length,
          createdBy: ctx.user.id,
        })
        .returning({ id: migrationFullJobs.id });
      if (!job) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Insert job fail." });
      }

      // Prepare tables — detect PK + tạo entity nếu cần.
      try {
        await prepareFullJobTables(
          job.id,
          ctx.user.companyId,
          ctx.user.id,
          input.connectionId,
          input.items as FullJobItem[],
          input.batchSize,
          input.targetTier,
        );
      } catch (e) {
        await ctx.db
          .update(migrationFullJobs)
          .set({ status: "failed", error: (e as Error).message, updatedAt: new Date() })
          .where(eq(migrationFullJobs.id, job.id));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (e as Error).message });
      }

      // Enqueue qua pg-boss. data.module = jobId.
      await enqueueMigrationJob({
        action: "full-import",
        module: job.id,
        args: {},
        userId: ctx.user.id,
        companyId: ctx.user.companyId,
      });

      appendDecision({
        module: `_quick-${input.connectionId}`,
        action: {
          type: "startFullImport",
          jobId: job.id,
          connectionId: input.connectionId,
          itemCount: input.items.length,
          batchSize: input.batchSize,
        },
        by: ctx.user.id,
      });

      return { jobId: job.id };
    }),

  /** Đổi tên các bảng thật đã promote (er_<id>) sang ĐÚNG tên bảng DB cũ
   *  (meta.source.mssqlTable). Bỏ qua mục đã đúng tên / không có nguồn / tên
   *  trùng (system, entity khác, bảng vật lý đã tồn tại). Cập nhật
   *  meta.storage.tableName + ghi lại COMMENT nhãn cột. */
  renamePromotedTablesToSource: rbacProcedure("edit", "settings").mutation(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ admin được đổi tên bảng thật." });
    }
    if (!isHybridTablesEnabled()) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Cần bật ERP_HYBRID_TABLES=1.",
      });
    }
    const rows = await ctx.db
      .select({
        id: entities.id,
        label: entities.label,
        fields: entities.fields,
        meta: entities.meta,
      })
      .from(entities)
      .where(eq(entities.companyId, ctx.user.companyId));

    const results: Array<{
      entityId: string;
      label: string;
      from: string;
      to: string;
      status: "renamed" | "skip" | "error";
      reason?: string;
    }> = [];

    for (const e of rows) {
      const meta = (e.meta ?? {}) as Record<string, unknown>;
      const storage = (meta as { storage?: EntityStorage }).storage;
      const source = (meta as { source?: { mssqlTable?: string } }).source?.mssqlTable;
      if (storage?.tier !== "table" || !source) continue;
      const from = storage.tableName;
      const to = await resolveTableName(ctx.db, e.id, source);
      if (to === from) {
        results.push({
          entityId: e.id,
          label: e.label,
          from,
          to,
          status: "skip",
          reason: "đã đúng tên",
        });
        continue;
      }
      // Bảng đích đã tồn tại → RENAME sẽ lỗi; bỏ qua an toàn.
      const reg = (await ctx.db.execute(sql`SELECT to_regclass(${to}) AS reg`)) as unknown as
        | Array<{ reg: string | null }>
        | { rows: Array<{ reg: string | null }> };
      const regList = Array.isArray(reg) ? reg : (reg.rows ?? []);
      if (regList[0]?.reg != null) {
        results.push({
          entityId: e.id,
          label: e.label,
          from,
          to,
          status: "skip",
          reason: `bảng "${to}" đã tồn tại`,
        });
        continue;
      }
      try {
        await ctx.db.execute(sql.raw(renameTableDDL(from, to)));
        const nextStorage: EntityStorage = { ...storage, tableName: to };
        await ctx.db
          .update(entities)
          .set({ meta: { ...meta, storage: nextStorage }, updatedAt: new Date() })
          .where(eq(entities.id, e.id));
        await applyColumnLabels(
          ctx.db,
          nextStorage,
          e.fields as Parameters<typeof applyColumnLabels>[2],
          e.label ?? undefined,
        );
        results.push({ entityId: e.id, label: e.label, from, to, status: "renamed" });
      } catch (err) {
        results.push({
          entityId: e.id,
          label: e.label,
          from,
          to,
          status: "error",
          reason: (err as Error).message,
        });
      }
    }
    void logActivity(ctx.db, {
      companyId: ctx.user.companyId,
      kind: "migration.rename_tables",
      target: "",
      detail: `Đổi tên ${results.filter((r) => r.status === "renamed").length} bảng thật theo DB cũ`,
      actorUserId: ctx.user.id,
    });
    return { results, renamed: results.filter((r) => r.status === "renamed").length };
  }),

  /** U4: List full jobs của company với progress summary. */
  listFullJobs: rbacProcedure("edit", "settings")
    .input(
      z
        .object({
          connectionId: z.string().uuid().optional(),
          statuses: z
            .array(z.enum(["queued", "running", "paused", "completed", "failed", "canceled"]))
            .optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: migrationFullJobs.id,
          connectionId: migrationFullJobs.connectionId,
          kind: migrationFullJobs.kind,
          status: migrationFullJobs.status,
          totalTables: migrationFullJobs.totalTables,
          completedTables: migrationFullJobs.completedTables,
          totalRowsImported: migrationFullJobs.totalRowsImported,
          startedAt: migrationFullJobs.startedAt,
          completedAt: migrationFullJobs.completedAt,
          lastHeartbeat: migrationFullJobs.lastHeartbeat,
          error: migrationFullJobs.error,
          createdAt: migrationFullJobs.createdAt,
          updatedAt: migrationFullJobs.updatedAt,
        })
        .from(migrationFullJobs)
        .where(eq(migrationFullJobs.companyId, ctx.user.companyId));

      const conns = await ctx.db
        .select({ id: mssqlConnections.id, name: mssqlConnections.name })
        .from(mssqlConnections)
        .where(eq(mssqlConnections.companyId, ctx.user.companyId));
      const connMap = new Map(conns.map((c) => [c.id, c.name]));

      const filtered = rows.filter((r) => {
        if (input?.connectionId && r.connectionId !== input.connectionId) return false;
        if (
          input?.statuses &&
          input.statuses.length > 0 &&
          !input.statuses.includes(r.status as never)
        )
          return false;
        return true;
      });

      return filtered
        .map((r) => ({
          ...r,
          connectionName: connMap.get(r.connectionId) ?? "(đã xoá)",
          startedAt: r.startedAt?.toISOString() ?? null,
          completedAt: r.completedAt?.toISOString() ?? null,
          lastHeartbeat: r.lastHeartbeat.toISOString(),
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }),

  /** U4: Chi tiết per-table của 1 job — progress + lastPk + error. */
  getFullJobDetail: rbacProcedure("edit", "settings")
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [job] = await ctx.db
        .select()
        .from(migrationFullJobs)
        .where(
          and(
            eq(migrationFullJobs.id, input.jobId),
            eq(migrationFullJobs.companyId, ctx.user.companyId),
          ),
        )
        .limit(1);
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job không tồn tại." });
      }
      const tables = await ctx.db
        .select()
        .from(migrationFullJobTables)
        .where(eq(migrationFullJobTables.jobId, input.jobId));
      return {
        job: {
          ...job,
          startedAt: job.startedAt?.toISOString() ?? null,
          completedAt: job.completedAt?.toISOString() ?? null,
          lastHeartbeat: job.lastHeartbeat.toISOString(),
          createdAt: job.createdAt.toISOString(),
          updatedAt: job.updatedAt.toISOString(),
        },
        tables: tables.map((t) => ({
          ...t,
          updatedAt: t.updatedAt.toISOString(),
        })),
      };
    }),

  /** U4: Re-enqueue 1 job để worker pickup lại — dùng cho resume thủ
   *  công khi job bị paused do lỗi network. Sync mode (kind='sync') sẽ
   *  chỉ lấy data mới theo lastPk hiện tại. */
  resumeFullJob: rbacProcedure("edit", "settings")
    .input(
      z.object({ jobId: z.string().uuid(), kind: z.enum(["resume", "sync"]).default("resume") }),
    )
    .mutation(async ({ ctx, input }) => {
      const [job] = await ctx.db
        .select()
        .from(migrationFullJobs)
        .where(
          and(
            eq(migrationFullJobs.id, input.jobId),
            eq(migrationFullJobs.companyId, ctx.user.companyId),
          ),
        )
        .limit(1);
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job không tồn tại." });
      }
      if (job.status === "canceled") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Job đã canceled — không thể resume.",
        });
      }

      // Sync mode: reset tables done → pending để worker re-stream với lastPk
      // hiện tại (chỉ lấy data mới). Resume thường: chỉ pickup tables chưa done.
      if (input.kind === "sync") {
        await ctx.db
          .update(migrationFullJobTables)
          .set({ status: "pending", error: null, updatedAt: new Date() })
          .where(
            and(
              eq(migrationFullJobTables.jobId, input.jobId),
              sql`${migrationFullJobTables.status} = 'done'`,
            ),
          );
        await ctx.db
          .update(migrationFullJobs)
          .set({
            kind: "sync",
            status: "queued",
            startedAt: null,
            completedAt: null,
            error: null,
            updatedAt: new Date(),
          })
          .where(eq(migrationFullJobs.id, input.jobId));
      } else {
        // Resume: reset failed tables về pending để retry.
        await ctx.db
          .update(migrationFullJobTables)
          .set({ status: "pending", error: null, updatedAt: new Date() })
          .where(
            and(
              eq(migrationFullJobTables.jobId, input.jobId),
              sql`${migrationFullJobTables.status} = 'failed'`,
            ),
          );
        await ctx.db
          .update(migrationFullJobs)
          .set({
            status: "queued",
            completedAt: null,
            error: null,
            updatedAt: new Date(),
          })
          .where(eq(migrationFullJobs.id, input.jobId));
      }

      await enqueueMigrationJob({
        action: "full-import",
        module: input.jobId,
        args: {},
        userId: ctx.user.id,
        companyId: ctx.user.companyId,
      });

      appendDecision({
        module: `_quick-${job.connectionId}`,
        action: {
          type: "resumeFullJob",
          jobId: input.jobId,
          mode: input.kind,
        },
        by: ctx.user.id,
      });

      return { jobId: input.jobId, status: "queued", mode: input.kind };
    }),

  /** U4: Cancel 1 job — set status='canceled'. Tables đã import giữ
   *  nguyên (records không bị xoá). */
  cancelFullJob: rbacProcedure("edit", "settings")
    .input(z.object({ jobId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [job] = await ctx.db
        .select({ id: migrationFullJobs.id })
        .from(migrationFullJobs)
        .where(
          and(
            eq(migrationFullJobs.id, input.jobId),
            eq(migrationFullJobs.companyId, ctx.user.companyId),
          ),
        )
        .limit(1);
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job không tồn tại." });
      }
      await ctx.db
        .update(migrationFullJobs)
        .set({
          status: "canceled",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(migrationFullJobs.id, input.jobId));
      appendDecision({
        module: "(full-import)",
        action: { type: "cancelFullJob", jobId: input.jobId },
        by: ctx.user.id,
      });
      return { jobId: input.jobId, status: "canceled" };
    }),

  /* ── Phase V — Auto-generate master-detail page từ relation graph ── */

  /** V1: Sinh page split-pane master-detail cho 1 entity. Scan forward
   *  refs (lookup fields trên master) + backward refs (entity khác trỏ
   *  về master) → build PageComponent[] gồm list trái + detail phải +
   *  N tab child list. Lưu vào pages, trả pageId. */
  generateMasterDetailPage: rbacProcedure("edit", "settings")
    .input(
      z.object({
        entityId: z.string().uuid(),
        pageName: z
          .string()
          .regex(/^[a-z][a-z0-9_]*$/)
          .optional(),
        pageLabel: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Load master entity.
      const [master] = await ctx.db
        .select()
        .from(entities)
        .where(and(eq(entities.companyId, ctx.user.companyId), eq(entities.id, input.entityId)))
        .limit(1);
      if (!master) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Entity không tồn tại." });
      }

      interface EntityField {
        name: string;
        label?: string;
        type: string;
        ref?: string;
        fkField?: string;
      }
      const masterFields = (master.fields as EntityField[]) ?? [];

      // Forward refs: lookup/relation field trên master.
      const forwardRefIds = new Set<string>();
      const forwardFields: Array<{ field: string; refEntityId: string }> = [];
      for (const f of masterFields) {
        if ((f.type === "lookup" || f.type === "multi-lookup" || f.type === "relation") && f.ref) {
          forwardRefIds.add(f.ref);
          forwardFields.push({ field: f.name, refEntityId: f.ref });
        }
      }

      const allEnts = await ctx.db
        .select({
          id: entities.id,
          name: entities.name,
          label: entities.label,
          fields: entities.fields,
        })
        .from(entities)
        .where(eq(entities.companyId, ctx.user.companyId));
      const entMap = new Map(allEnts.map((e) => [e.id, e]));

      // Source 1 — Collection fields trên master (explicit declaration).
      // Ưu tiên: nếu master khai báo field type='collection' → dùng config đó.
      const backwardChildren: Array<{
        entityId: string;
        entityName: string;
        entityLabel: string;
        fkField: string;
        label?: string;
        source: "collection" | "backward-ref";
      }> = [];
      const seenKey = new Set<string>(); // dedup theo "entityId:fkField"
      for (const f of masterFields) {
        if (f.type === "collection" && f.ref && f.fkField) {
          const child = entMap.get(f.ref);
          if (!child) continue;
          const key = `${child.id}:${f.fkField}`;
          if (seenKey.has(key)) continue;
          seenKey.add(key);
          backwardChildren.push({
            entityId: child.id,
            entityName: child.name,
            entityLabel: child.label,
            fkField: f.fkField,
            label: f.label ?? child.label,
            source: "collection",
          });
        }
      }

      // Source 2 — Backward refs auto-scan: bổ sung child entity có field
      // lookup trỏ về master nhưng CHƯA có collection field tương ứng.
      for (const e of allEnts) {
        if (e.id === master.id) continue;
        const fs = (e.fields as EntityField[]) ?? [];
        for (const f of fs) {
          if (
            (f.type === "lookup" || f.type === "multi-lookup" || f.type === "relation") &&
            f.ref === master.id
          ) {
            const key = `${e.id}:${f.name}`;
            if (seenKey.has(key)) continue;
            seenKey.add(key);
            backwardChildren.push({
              entityId: e.id,
              entityName: e.name,
              entityLabel: e.label,
              fkField: f.name,
              source: "backward-ref",
            });
          }
        }
      }

      // Build PageComponent[]. Grid 12 cột, list trái w=6, detail phải w=6.
      const components: Array<{
        id: string;
        kind: string;
        x: number;
        y: number;
        w: number;
        h: number;
        config: Record<string, unknown>;
      }> = [];

      const stateKey = "selected_master";

      // Layout: list trái w=6 h=10, detail phải h=4, child stack dưới.
      // gridAutoRows 76px → list ~760px, detail 304px, mỗi child 304px.
      components.push({
        id: `list-master-${master.id.slice(0, 8)}`,
        kind: "list",
        x: 0,
        y: 0,
        w: 6,
        h: 10,
        config: {
          entity: master.id,
          selectionStateKey: stateKey,
          title: master.label,
        },
      });

      components.push({
        id: `detail-master-${master.id.slice(0, 8)}`,
        kind: "detail",
        x: 6,
        y: 0,
        w: 6,
        h: 4,
        config: {
          entity: master.id,
          recordIdFromState: stateKey,
          forwardRefs: forwardFields,
          title: `Chi tiết ${master.label}`,
        },
      });

      let curY = 4;
      const childHeight = 3;
      for (const child of backwardChildren) {
        components.push({
          id: `list-child-${child.entityId.slice(0, 8)}-${child.fkField}`,
          kind: "list",
          x: 6,
          y: curY,
          w: 6,
          h: childHeight,
          config: {
            entity: child.entityId,
            filterFromState: { field: child.fkField, stateKey },
            title: child.label ?? child.entityLabel,
            // Đánh dấu source để FE biết đây là collection-driven (giúp debug).
            source: child.source,
          },
        });
        curY += childHeight;
      }

      // Sinh name + label.
      const slug = (s: string) =>
        s
          .toLowerCase()
          .replace(/[^a-z0-9_]+/g, "_")
          .replace(/^_+|_+$/g, "");
      const pageName = input.pageName ?? `${slug(master.name)}_master_detail`;
      const pageLabel = input.pageLabel ?? `${master.label} - Chi tiết`;

      // Upsert page (theo name unique per company).
      const [existing] = await ctx.db
        .select({ id: pages.id })
        .from(pages)
        .where(and(eq(pages.companyId, ctx.user.companyId), eq(pages.name, pageName)))
        .limit(1);

      let pageId: string;
      if (existing) {
        const [updated] = await ctx.db
          .update(pages)
          .set({
            label: pageLabel,
            content: components,
            updatedAt: new Date(),
          })
          .where(eq(pages.id, existing.id))
          .returning({ id: pages.id });
        if (!updated) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Update page fail." });
        }
        pageId = updated.id;
      } else {
        const [inserted] = await ctx.db
          .insert(pages)
          .values({
            companyId: ctx.user.companyId,
            name: pageName,
            label: pageLabel,
            icon: "Layout",
            content: components,
          })
          .returning({ id: pages.id });
        if (!inserted) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Insert page fail." });
        }
        pageId = inserted.id;
      }

      appendDecision({
        module: "(master-detail)",
        action: {
          type: "generateMasterDetailPage",
          masterEntity: master.name,
          forwardRefs: forwardFields.length,
          backwardChildren: backwardChildren.length,
          pageId,
          pageName,
        },
        by: ctx.user.id,
      });

      return {
        pageId,
        pageName,
        pageLabel,
        upserted: existing ? ("updated" as const) : ("created" as const),
        masterEntity: master.name,
        forwardRefs: forwardFields,
        backwardChildren,
      };
    }),

  /* ── Phase T — Tracking + cleanup an toàn ────────────────── */

  /** T2: Liệt kê tất cả entity do migration tạo (meta.source.kind=migration).
   *  Trả kèm recordCount + meta.source để UI hiển thị + làm cleanup. */
  listMigratedEntities: rbacProcedure("edit", "settings")
    .input(
      z
        .object({
          connectionId: z.string().uuid().optional(),
          module: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      // Drizzle filter trên JSONB path: dùng raw SQL fragment.
      const rows = await ctx.db
        .select({
          id: entities.id,
          name: entities.name,
          label: entities.label,
          meta: entities.meta,
          createdAt: entities.createdAt,
          updatedAt: entities.updatedAt,
        })
        .from(entities)
        .where(
          and(
            eq(entities.companyId, ctx.user.companyId),
            sql`${entities.meta}->'source'->>'kind' = 'migration'`,
          ),
        );

      // Lấy recordCount + connection name song song.
      const connIds = new Set<string>();
      for (const r of rows) {
        const src = (r.meta as { source?: { connectionId?: string } } | null)?.source;
        if (src?.connectionId) connIds.add(src.connectionId);
      }
      const connNames = new Map<string, string>();
      if (connIds.size > 0) {
        const conns = await ctx.db
          .select({ id: mssqlConnections.id, name: mssqlConnections.name })
          .from(mssqlConnections)
          .where(eq(mssqlConnections.companyId, ctx.user.companyId));
        for (const c of conns) connNames.set(c.id, c.name);
      }

      const counts = await ctx.db
        .select({
          entityId: entityRecords.entityId,
          count: sql<number>`count(*)::int`,
        })
        .from(entityRecords)
        .where(eq(entityRecords.companyId, ctx.user.companyId))
        .groupBy(entityRecords.entityId);
      const countMap = new Map(counts.map((c) => [c.entityId, c.count]));
      // Entity tier='table' (HYBRID): data sống ở bảng thật — đếm ở đó thay vì
      // EAV (EAV chỉ còn snapshot đông lạnh hoặc rỗng → số sai).
      for (const r of rows) {
        const storage = tableStorageOf(r.meta);
        if (!storage) continue;
        try {
          countMap.set(r.id, await countTableRows(ctx.db, ctx.user.companyId, storage));
        } catch {
          /* bảng thật mất (drift) → giữ count EAV */
        }
      }

      const filtered = rows.filter((r) => {
        const src = (r.meta as { source?: { connectionId?: string; module?: string } } | null)
          ?.source;
        if (input?.connectionId && src?.connectionId !== input.connectionId) return false;
        if (input?.module && src?.module !== input.module) return false;
        return true;
      });

      return filtered
        .map((r) => {
          const src = (
            r.meta as {
              source?: {
                connectionId?: string;
                module?: string;
                mssqlTable?: string;
                importedAt?: string;
                importedBy?: string;
                rowsLastImported?: number;
              };
            } | null
          )?.source;
          return {
            id: r.id,
            name: r.name,
            label: r.label,
            mssqlTable: src?.mssqlTable ?? null,
            module: src?.module ?? null,
            connectionId: src?.connectionId ?? null,
            connectionName: src?.connectionId
              ? (connNames.get(src.connectionId) ?? "(đã xoá)")
              : null,
            importedAt: src?.importedAt ?? null,
            rowsLastImported: src?.rowsLastImported ?? 0,
            recordCount: countMap.get(r.id) ?? 0,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
          };
        })
        .sort((a, b) => (b.importedAt ?? "").localeCompare(a.importedAt ?? ""));
    }),

  /** T2: Xoá selective. Mode quyết định scope. Guard cứng: chỉ xoá nếu
   *  meta.source.kind === 'migration'. */
  cleanupMigratedEntity: rbacProcedure("edit", "settings")
    .input(
      z.object({
        entityId: z.string().uuid(),
        mode: z.enum(["records-only", "entity-and-records", "re-migrate"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [ent] = await ctx.db
        .select()
        .from(entities)
        .where(and(eq(entities.companyId, ctx.user.companyId), eq(entities.id, input.entityId)))
        .limit(1);
      if (!ent) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Entity không tồn tại." });
      }
      const src = (
        ent.meta as {
          source?: {
            kind?: string;
            connectionId?: string;
            mssqlTable?: string;
            module?: string;
          };
        } | null
      )?.source;
      if (src?.kind !== "migration") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Entity "${ent.name}" không phải do migration tạo (kind=${
            src?.kind ?? "undefined"
          }). Không cho xoá qua endpoint này để tránh xoá nhầm entity hệ thống.`,
        });
      }

      // HYBRID: entity đã promote sang bảng thật → data sống ở đó, EAV chỉ là
      // snapshot đông lạnh. Mọi nhánh dưới route theo storage.
      const storage = tableStorageOf(ent.meta);

      // records-only: xoá records (bảng thật nếu tier='table', kèm snapshot
      // EAV + locator), giữ entity.
      if (input.mode === "records-only" || input.mode === "re-migrate") {
        let deletedRecords: number;
        if (storage) {
          deletedRecords = await purgeTableRows(
            ctx.db,
            ctx.user.companyId,
            input.entityId,
            storage,
          );
        } else {
          const del = await ctx.db
            .delete(entityRecords)
            .where(
              and(
                eq(entityRecords.companyId, ctx.user.companyId),
                eq(entityRecords.entityId, input.entityId),
              ),
            )
            .returning({ id: entityRecords.id });
          deletedRecords = del.length;
        }
        appendDecision({
          module: src.module ?? "(unknown)",
          action: {
            type: "cleanupMigratedEntity",
            mode: input.mode === "re-migrate" ? "records-only-prelude" : "records-only",
            entityId: input.entityId,
            entityName: ent.name,
            tier: storage ? "table" : "eav",
            deletedRecords,
          },
          by: ctx.user.id,
        });
        if (input.mode === "records-only") {
          return {
            mode: "records-only" as const,
            entityId: input.entityId,
            deletedRecords,
            entityKept: true,
          };
        }
      }

      // entity-and-records: xoá entity (CASCADE FK xoá records EAV) + DROP
      // bảng thật nếu tier='table' (bảng vật lý KHÔNG nằm trong cascade).
      if (input.mode === "entity-and-records") {
        // Đếm trước để báo về (theo tier — EAV của entity promoted chỉ là snapshot).
        let recordCount: number;
        if (storage) {
          recordCount = await countTableRows(ctx.db, ctx.user.companyId, storage).catch(() => 0);
        } else {
          const [cnt] = await ctx.db
            .select({ n: sql<number>`count(*)::int` })
            .from(entityRecords)
            .where(
              and(
                eq(entityRecords.companyId, ctx.user.companyId),
                eq(entityRecords.entityId, input.entityId),
              ),
            );
          recordCount = cnt?.n ?? 0;
        }
        await ctx.db
          .delete(entities)
          .where(and(eq(entities.companyId, ctx.user.companyId), eq(entities.id, input.entityId)));
        if (storage) {
          await dropTableForEntity(ctx.db, ctx.user.companyId, input.entityId, storage);
        }

        // Gỡ migratedAt khỏi manifest _quick-* hoặc module yaml tương ứng.
        if (src.module && src.mssqlTable) {
          const p = resolve(MODULES_DIR(), `${src.module}.yaml`);
          if (existsSync(p)) {
            try {
              const m = YAML.parse(readFileSync(p, "utf8")) as {
                tables?: Array<{
                  name: string;
                  migratedAt?: string;
                  migrateStats?: Record<string, unknown>;
                }>;
              };
              for (const t of m.tables ?? []) {
                if (t.name.toLowerCase() === src.mssqlTable.toLowerCase()) {
                  delete t.migratedAt;
                  delete t.migrateStats;
                }
              }
              writeFileSync(p, YAML.stringify(m, { lineWidth: 0 }), "utf8");
            } catch {
              /* skip yaml hỏng */
            }
          }
        }

        appendDecision({
          module: src.module ?? "(unknown)",
          action: {
            type: "cleanupMigratedEntity",
            mode: "entity-and-records",
            entityId: input.entityId,
            entityName: ent.name,
            mssqlTable: src.mssqlTable,
            tier: storage ? "table" : "eav",
            deletedRecords: recordCount,
          },
          by: ctx.user.id,
        });
        return {
          mode: "entity-and-records" as const,
          entityId: input.entityId,
          deletedRecords: recordCount,
          entityDeleted: true,
        };
      }

      // re-migrate: records đã xoá ở nhánh trên → mở MSSQL + bulkRead + insert.
      if (!src.connectionId || !src.mssqlTable) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Entity thiếu source.connectionId hoặc source.mssqlTable — không thể re-migrate. Xoá entity rồi tạo lại qua Quick Migrate.",
        });
      }

      // Load connection trực tiếp (không qua openDefaultMssql vì có thể đã đổi default).
      const [conn] = await ctx.db
        .select()
        .from(mssqlConnections)
        .where(
          and(
            eq(mssqlConnections.companyId, ctx.user.companyId),
            eq(mssqlConnections.id, src.connectionId),
          ),
        )
        .limit(1);
      if (!conn) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Connection MSSQL gốc đã bị xoá (id=${src.connectionId}). Không re-migrate được.`,
        });
      }
      const client = MssqlClient.fromConfig({
        host: conn.host,
        port: conn.port,
        database: conn.database,
        username: conn.username,
        password: decryptSecret(conn.passwordEnc),
        encrypt: conn.encrypt,
        trustServerCert: conn.trustServerCert,
        allowWrite: conn.allowWrite,
        requestTimeoutMs: 60_000,
      });
      let rowsRead = 0;
      let rowsUpserted = 0;
      try {
        await client.connect();
        const rows = await client.bulkRead<Record<string, unknown>>(src.mssqlTable, {
          limit: 50_000,
        });
        rowsRead = rows.length;
        if (rows.length > 0) {
          // Tái dùng map cột: lower-case key theo fields hiện có của entity.
          const fields = (ent.fields as Array<{ name: string }>) ?? [];
          const fieldSet = new Set(fields.map((f) => f.name.toLowerCase()));
          const mapped = rows.map((r) => {
            const data: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(r)) {
              const key = k.toLowerCase();
              if (fieldSet.size === 0 || fieldSet.has(key)) {
                data[key] = v;
              }
            }
            return data;
          });
          // HYBRID-aware: bảng thật → insertRowToTable + locator; EAV → insert
          // thẳng (records cũ đã purge ở nhánh prelude phía trên).
          const w = await writeMappedRows({
            db: ctx.db,
            companyId: ctx.user.companyId,
            userId: ctx.user.id,
            entityId: input.entityId,
            mapped,
          });
          rowsUpserted = w.rowsUpserted;
        }
      } finally {
        await client.close().catch(() => undefined);
      }

      // Cập nhật meta.source.importedAt (merge — giữ meta.storage).
      await mergeSourceMeta(ctx.db, input.entityId, {
        ...src,
        kind: "migration",
        importedAt: new Date().toISOString(),
        importedBy: ctx.user.id,
        rowsLastImported: rowsUpserted,
      });

      appendDecision({
        module: src.module ?? "(unknown)",
        action: {
          type: "cleanupMigratedEntity",
          mode: "re-migrate",
          entityId: input.entityId,
          entityName: ent.name,
          mssqlTable: src.mssqlTable,
          tier: storage ? "table" : "eav",
          rowsRead,
          rowsUpserted,
        },
        by: ctx.user.id,
      });

      return {
        mode: "re-migrate" as const,
        entityId: input.entityId,
        rowsRead,
        rowsUpserted,
      };
    }),

  /** T2: Bulk cleanup theo scope (connectionId hoặc module). Loop apply
   *  cleanupMigratedEntity cho từng entity match. */
  cleanupAllMigrated: rbacProcedure("edit", "settings")
    .input(
      z.object({
        scope: z
          .object({
            connectionId: z.string().uuid().optional(),
            module: z.string().optional(),
          })
          .default({}),
        mode: z.enum(["records-only", "entity-and-records", "re-migrate"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const all = await ctx.db
        .select({ id: entities.id, name: entities.name, meta: entities.meta })
        .from(entities)
        .where(
          and(
            eq(entities.companyId, ctx.user.companyId),
            sql`${entities.meta}->'source'->>'kind' = 'migration'`,
          ),
        );

      const targets = all.filter((r) => {
        const src = (r.meta as { source?: { connectionId?: string; module?: string } } | null)
          ?.source;
        if (input.scope.connectionId && src?.connectionId !== input.scope.connectionId)
          return false;
        if (input.scope.module && src?.module !== input.scope.module) return false;
        return true;
      });

      const results: Array<{ entityId: string; name: string; ok: boolean; error?: string }> = [];
      for (const t of targets) {
        try {
          // Reuse logic: gọi inline qua DB ops giống cleanupMigratedEntity.
          // Để tránh duplicate code lớn, ghi nhận đơn giản — caller có thể
          // chia nhỏ qua cleanupMigratedEntity từng cái.
          const storage = tableStorageOf(t.meta);
          if (input.mode === "records-only") {
            if (storage) {
              // HYBRID: xoá row bảng thật + locator + snapshot EAV.
              await purgeTableRows(ctx.db, ctx.user.companyId, t.id, storage);
            } else {
              await ctx.db
                .delete(entityRecords)
                .where(
                  and(
                    eq(entityRecords.companyId, ctx.user.companyId),
                    eq(entityRecords.entityId, t.id),
                  ),
                );
            }
          } else if (input.mode === "entity-and-records") {
            await ctx.db
              .delete(entities)
              .where(and(eq(entities.companyId, ctx.user.companyId), eq(entities.id, t.id)));
            if (storage) {
              // Bảng vật lý không nằm trong cascade FK → drop tường minh.
              await dropTableForEntity(ctx.db, ctx.user.companyId, t.id, storage);
            }
          } else if (input.mode === "re-migrate") {
            // Skip — re-migrate phức tạp (cần MSSQL), caller nên gọi tuần
            // tự qua cleanupMigratedEntity per entity để có progress + retry.
            throw new Error("Bulk re-migrate chưa hỗ trợ — gọi cleanupMigratedEntity từng entity.");
          }
          results.push({ entityId: t.id, name: t.name, ok: true });
        } catch (e) {
          results.push({ entityId: t.id, name: t.name, ok: false, error: (e as Error).message });
        }
      }

      appendDecision({
        module: input.scope.module ?? "(cross-module)",
        action: {
          type: "cleanupAllMigrated",
          mode: input.mode,
          scope: input.scope,
          total: targets.length,
          succeeded: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
        },
        by: ctx.user.id,
      });

      return {
        total: targets.length,
        succeeded: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      };
    }),

  /** Kiểm tra trạng thái trước khi user chạy job — UI hiển thị cảnh báo. */
  envCheck: rbacProcedure("edit", "settings").query(async ({ ctx }) => {
    // Connection MSSQL lấy từ DB theo company (active session).
    const [cnt] = await ctx.db
      .select({
        total: sql<number>`count(*)::int`,
        hasDefault: sql<boolean>`bool_or(${mssqlConnections.isDefault})`,
      })
      .from(mssqlConnections)
      .where(eq(mssqlConnections.companyId, ctx.user.companyId));
    return {
      connectionCount: cnt?.total ?? 0,
      hasDefaultConnection: cnt?.hasDefault === true,
      migrationRootExists: existsSync(MIGRATION_ROOT()),
      modulesDirExists: existsSync(MODULES_DIR()),
    };
  }),

  /* ── V2: Migrate stored procedures ────────────────────────────
   * Liệt kê proc trong manifest module + filter theo "đã migrate
   * bảng nào" + sort theo complexity + đánh dấu nghiệp vụ AI. */
  listProcsToMigrate: rbacProcedure("edit", "settings")
    .input(
      z.object({
        /** Module manifest YAML. Accept cả _quick-* prefix. */
        module: z.string().min(1).max(80),
        /** "all" → reads ∪ writes đã migrate. "reads-only" → chỉ reads. */
        filterMode: z.enum(["all", "reads-only"]).default("all"),
        /** Chỉ proc có lastExecAt < N ngày. 0 = bỏ filter. */
        activeWithinDays: z.number().int().min(0).max(3650).default(0),
        /** Sort. */
        sortBy: z.enum(["complexity-asc", "complexity-desc", "name"]).default("complexity-asc"),
        /** Bao gồm proc dirty (blocked) trong output để UI hiển thị disabled. */
        includeBlocked: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const p = resolve(MODULES_DIR(), `${input.module}.yaml`);
      if (!existsSync(p)) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Manifest module không tồn tại: ${input.module}`,
        });
      }
      const manifest = YAML.parse(readFileSync(p, "utf8")) as {
        procs?: Array<{
          name: string;
          reads?: string[];
          writes?: string[];
          flags?: string[];
          suggestedTier?: "B" | "C" | "D";
          active?: boolean;
          lastExecAt?: string | null;
          execCount?: number;
          businessCategory?: string;
          businessCategoryConfidence?: number;
          userOverrideCategory?: string;
          targetProcName?: string;
          targetFile?: string;
          callsProcs?: string[];
          label?: string;
          description?: string;
        }>;
      };

      // Combined: YAML manifest tables + DB entities (Migrate nhanh).
      const migrated = (await buildCombinedMigratedSet(ctx.db, ctx.user.companyId)).tables;
      const cutoff =
        input.activeWithinDays > 0 ? Date.now() - input.activeWithinDays * 86_400_000 : 0;

      const rows = (manifest.procs ?? []).map((proc) => {
        const reads = proc.reads ?? [];
        const writes = proc.writes ?? [];
        const all = [...new Set([...reads, ...writes])];
        const missing = all.filter((t) => !migrated.has(t.toLowerCase()));
        const readsMissing = reads.filter((t) => !migrated.has(t.toLowerCase()));

        let filterStatus: "ready" | "partial" | "blocked";
        if (missing.length === 0) filterStatus = "ready";
        else if (input.filterMode === "reads-only" && readsMissing.length === 0)
          filterStatus = "partial";
        else filterStatus = "blocked";

        // Complexity: reads + writes*2 + (callsProcs nested) + flags*5
        const complexity =
          reads.length +
          writes.length * 2 +
          (proc.callsProcs?.length ?? 0) * 3 +
          (proc.flags?.length ?? 0) * 5;

        return {
          name: proc.name,
          reads,
          writes,
          missingTables: missing,
          filterStatus,
          active: proc.active !== false,
          lastExecAt: proc.lastExecAt ?? null,
          execCount: proc.execCount ?? 0,
          complexity,
          suggestedTier: proc.suggestedTier ?? "D",
          businessCategory: proc.userOverrideCategory ?? proc.businessCategory ?? null,
          businessCategoryConfidence: proc.businessCategoryConfidence ?? null,
          targetProcName: proc.targetProcName ?? null,
          targetFile: proc.targetFile ?? null,
          label: proc.label ?? null,
          description: proc.description ?? null,
          flags: proc.flags ?? [],
        };
      });

      const filtered = rows.filter((r) => {
        if (!input.includeBlocked && r.filterStatus === "blocked") return false;
        if (cutoff > 0) {
          if (!r.lastExecAt) return false;
          if (new Date(r.lastExecAt).getTime() < cutoff) return false;
        }
        return true;
      });

      filtered.sort((a, b) => {
        if (input.sortBy === "name") return a.name.localeCompare(b.name);
        if (input.sortBy === "complexity-desc") return b.complexity - a.complexity;
        return a.complexity - b.complexity;
      });

      const totalReady = rows.filter((r) => r.filterStatus === "ready").length;
      const totalBlocked = rows.filter((r) => r.filterStatus === "blocked").length;
      const totalPartial = rows.filter((r) => r.filterStatus === "partial").length;

      return {
        module: input.module,
        rows: filtered,
        counts: {
          total: rows.length,
          ready: totalReady,
          partial: totalPartial,
          blocked: totalBlocked,
          shown: filtered.length,
        },
        migratedTableCount: migrated.size,
      };
    }),

  /** Aggregate cross-module — quét TẤT CẢ manifest YAML trong migration-plan/
   *  modules/ và trả proc rows đã filter, grouped theo module.
   *  Dùng cho screen "Migrate proc đa-module" trong nhóm Công cụ migrate. */
  listAllProcsToMigrate: rbacProcedure("edit", "settings")
    .input(
      z.object({
        filterMode: z.enum(["all", "reads-only"]).default("all"),
        activeWithinDays: z.number().int().min(0).max(3650).default(0),
        sortBy: z.enum(["complexity-asc", "complexity-desc", "name"]).default("complexity-asc"),
        includeBlocked: z.boolean().default(false),
        /** Substring lọc module name (case-insensitive). */
        moduleFilter: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const dir = MODULES_DIR();
      // Combined: YAML + DB entities. Phải lấy ra trước cả check existsSync(dir)
      // để cover trường hợp chỉ migrate bằng Migrate nhanh (không có YAML).
      const migrated = (await buildCombinedMigratedSet(ctx.db, ctx.user.companyId)).tables;

      // Tải procedure names từ DB một lần để tính codegenApplied tier B.
      const dbProcs = await ctx.db
        .select({ name: procedures.name })
        .from(procedures)
        .where(eq(procedures.companyId, ctx.user.companyId));
      const dbProcMap = new Map(dbProcs.map((r) => [r.name.toLowerCase(), r.name]));

      if (!existsSync(dir)) {
        return {
          rowsByModule: {} as Record<string, ReturnType<typeof shapeProcRow>[]>,
          modules: [] as string[],
          counts: { total: 0, ready: 0, partial: 0, blocked: 0, shown: 0 },
          migratedTableCount: migrated.size,
        };
      }
      const cutoff =
        input.activeWithinDays > 0 ? Date.now() - input.activeWithinDays * 86_400_000 : 0;
      const mfLower = input.moduleFilter?.toLowerCase() ?? "";

      const files = readdirSync(dir).filter(
        (f) => f.endsWith(".yaml") && !f.startsWith("_example") && !f.endsWith(".enriched.yaml"),
      );

      const rowsByModule: Record<string, ReturnType<typeof shapeProcRow>[]> = {};
      const moduleNames: string[] = [];
      let totTotal = 0;
      let totReady = 0;
      let totPartial = 0;
      let totBlocked = 0;
      let totShown = 0;

      for (const f of files) {
        const moduleName = f.replace(/\.yaml$/, "");
        if (mfLower && !moduleName.toLowerCase().includes(mfLower)) continue;

        let manifest: { procs?: Array<Record<string, unknown>> };
        try {
          manifest = YAML.parse(readFileSync(resolve(dir, f), "utf8")) as typeof manifest;
        } catch {
          continue;
        }

        const allRows = (manifest.procs ?? []).map((p) =>
          shapeProcRow(p, migrated, input.filterMode, dbProcMap),
        );

        const filtered = allRows.filter((r) => {
          if (!input.includeBlocked && r.filterStatus === "blocked") return false;
          if (cutoff > 0) {
            if (!r.lastExecAt) return false;
            if (new Date(r.lastExecAt).getTime() < cutoff) return false;
          }
          return true;
        });

        filtered.sort((a, b) => {
          if (input.sortBy === "name") return a.name.localeCompare(b.name);
          if (input.sortBy === "complexity-desc") return b.complexity - a.complexity;
          return a.complexity - b.complexity;
        });

        totTotal += allRows.length;
        totReady += allRows.filter((r) => r.filterStatus === "ready").length;
        totPartial += allRows.filter((r) => r.filterStatus === "partial").length;
        totBlocked += allRows.filter((r) => r.filterStatus === "blocked").length;
        totShown += filtered.length;

        if (filtered.length > 0) {
          rowsByModule[moduleName] = filtered;
          moduleNames.push(moduleName);
        }
      }

      return {
        rowsByModule,
        modules: moduleNames.sort(),
        counts: {
          total: totTotal,
          ready: totReady,
          partial: totPartial,
          blocked: totBlocked,
          shown: totShown,
        },
        migratedTableCount: migrated.size,
      };
    }),

  /** AI phân loại nghiệp vụ cho list proc — ghi kết quả vào manifest YAML.
   *  Idempotent: mode="skip-existing" (default) bỏ proc đã classify; "if-stale"
   *  bỏ proc có bodyHash khớp; "force" chạy mọi proc.
   *  Bảo toàn userOverrideCategory — không bao giờ ghi đè. */
  classifyProcsAi: rbacProcedure("edit", "settings")
    .input(
      z.object({
        module: z.string().min(1).max(80),
        /** Tên proc đầy đủ schema.name. Nếu rỗng → classify tất cả proc trong manifest. */
        names: z.array(z.string()).default([]),
        /** Kết nối MSSQL để fetch body. Nếu rỗng → dùng default connection. */
        connectionId: z.string().uuid().optional(),
        /** Chế độ chạy lại:
         *  - skip-existing (default): bỏ proc đã có businessCategory
         *  - if-stale: chạy lại nếu bodyHash khác cache (body đã đổi trong MSSQL)
         *  - force: chạy lại tất cả không quan tâm cache */
        mode: z.enum(["skip-existing", "if-stale", "force"]).default("skip-existing"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const p = resolve(MODULES_DIR(), `${input.module}.yaml`);
      if (!existsSync(p)) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Manifest module không tồn tại: ${input.module}`,
        });
      }
      const manifest = YAML.parse(readFileSync(p, "utf8")) as {
        procs?: Array<Record<string, unknown>>;
      };
      const procs = manifest.procs ?? [];
      const targets =
        input.names.length > 0
          ? procs.filter((pr) => input.names.includes(pr.name as string))
          : procs;

      if (targets.length === 0) {
        return { module: input.module, classified: 0, skipped: 0, results: [] };
      }

      const mssql = input.connectionId
        ? await openMssqlById(ctx.db, ctx.user.companyId, input.connectionId)
        : await openDefaultMssql(ctx.db, ctx.user.companyId);

      const skippedNames: string[] = [];
      const cachedHits: Array<{ name: string; cache: Record<string, unknown> }> = [];

      try {
        const inputs: ProcClassifyInput[] = [];
        for (const pr of targets) {
          const name = pr.name as string;
          const body = await fetchProcBody(mssql, name);
          if (!body) {
            skippedNames.push(name);
            continue;
          }
          const hash = bodyHash(body);

          // ── Skip logic theo mode ──
          if (input.mode === "skip-existing" && pr.businessCategory) {
            skippedNames.push(name);
            continue;
          }
          if (input.mode === "if-stale" && pr.bodyHash === hash) {
            // Body chưa đổi → re-use cache nếu có
            if (
              pr.aiClassifyCache &&
              (pr.aiClassifyCache as { bodyHash: string }).bodyHash === hash
            ) {
              cachedHits.push({ name, cache: pr.aiClassifyCache as Record<string, unknown> });
              skippedNames.push(name);
              continue;
            }
          }

          // Lưu bodyHash trên proc trước khi classify để track sau này.
          pr.bodyHash = hash;

          inputs.push({
            name,
            body,
            reads: (pr.reads as string[]) ?? [],
            writes: (pr.writes as string[]) ?? [],
            flags: (pr.flags as string[]) ?? [],
            label: pr.label as string | undefined,
            description: pr.description as string | undefined,
          });
        }

        const results =
          inputs.length > 0 ? await classifyProcsBatch(ctx.db, ctx.user.companyId, inputs) : [];
        const now = new Date().toISOString();
        const byName = new Map(results.map((r) => [r.name, r]));

        for (const pr of procs) {
          const name = pr.name as string;
          const r = byName.get(name);
          if (!r) continue;
          // KHÔNG ghi đè khi user đã override — preserve.
          if (!pr.userOverrideCategory) {
            pr.businessCategory = r.category;
            pr.businessCategoryConfidence = r.confidence;
          }
          pr.aiClassifiedAt = now;
          pr.aiClassifyCache = {
            bodyHash: pr.bodyHash,
            category: r.category,
            confidence: r.confidence,
            reasoning: r.reasoning,
            recommendedTier: r.recommendedTier,
            at: now,
          };
          if (r.recommendedTier && !pr.targetProcName && !pr.targetFile && !pr.targetWorkflowId) {
            // Chỉ gợi ý tier khi user chưa apply codegen tier nào — không override.
            pr.suggestedTier = r.recommendedTier;
          }
        }

        if (results.length > 0 || cachedHits.length > 0) {
          writeFileSync(p, YAML.stringify(manifest, { lineWidth: 0 }), "utf8");
        }

        if (results.length > 0) {
          appendDecision({
            module: input.module,
            action: "classifyProcsAi",
            by: ctx.user.id,
            args: { mode: input.mode, classified: results.length, skipped: skippedNames.length },
          });
        }

        return {
          module: input.module,
          classified: results.length,
          skipped: skippedNames.length,
          cached: cachedHits.length,
          results,
          skippedNames,
        };
      } finally {
        await mssql.close();
      }
    }),

  /** Tier C codegen — convert proc → WorkflowDef. Dùng cache nếu bodyHash khớp,
   *  tránh gọi LLM lặp lại (tiết kiệm chi phí + đảm bảo idempotent).
   *  Set useCache=false để force re-call LLM. */
  codegenProcWorkflowDryRun: rbacProcedure("edit", "settings")
    .input(
      z.object({
        module: z.string().min(1).max(80),
        procName: z.string().min(1),
        connectionId: z.string().uuid().optional(),
        /** false → bypass cache, gọi LLM lại. Default true. */
        useCache: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const p = resolve(MODULES_DIR(), `${input.module}.yaml`);
      if (!existsSync(p)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Manifest không tồn tại." });
      }
      const manifest = YAML.parse(readFileSync(p, "utf8")) as {
        procs?: Array<Record<string, unknown>>;
        tables?: Array<{ name: string; suggestedEntityName?: string }>;
      };
      const proc = (manifest.procs ?? []).find((pr) => pr.name === input.procName);
      if (!proc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Proc không có trong manifest." });
      }

      const mssql = input.connectionId
        ? await openMssqlById(ctx.db, ctx.user.companyId, input.connectionId)
        : await openDefaultMssql(ctx.db, ctx.user.companyId);

      try {
        const body = await fetchProcBody(mssql, input.procName);
        if (!body) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Không lấy được body proc từ MSSQL.",
          });
        }
        const hash = bodyHash(body);

        // Cache hit check
        if (input.useCache && proc.aiWorkflowCache) {
          const cache = proc.aiWorkflowCache as {
            bodyHash: string;
            graph: { nodes: unknown[]; edges: unknown[] };
            at: string;
          };
          if (cache.bodyHash === hash && cache.graph) {
            return {
              ok: true,
              graph: cache.graph,
              error: undefined,
              fromCache: true,
              cacheAt: cache.at,
            };
          }
        }

        // Build mapping table → entity từ manifest hiện tại.
        const tableToEntity: Record<string, string> = {};
        for (const t of manifest.tables ?? []) {
          if (t.suggestedEntityName) tableToEntity[t.name] = t.suggestedEntityName;
        }
        const result = await codegenProcWorkflow(ctx.db, ctx.user.companyId, {
          name: input.procName,
          body,
          reads: (proc.reads as string[]) ?? [],
          writes: (proc.writes as string[]) ?? [],
          tableToEntity,
          label: proc.label as string | undefined,
          description: proc.description as string | undefined,
        });

        // Lưu cache khi có graph hợp lệ.
        if (result.graph) {
          proc.bodyHash = hash;
          proc.aiWorkflowCache = {
            bodyHash: hash,
            graph: result.graph,
            at: new Date().toISOString(),
          };
          writeFileSync(p, YAML.stringify(manifest, { lineWidth: 0 }), "utf8");
        }

        return {
          ok: result.graph != null,
          graph: result.graph,
          error: result.error,
          fromCache: false,
        };
      } finally {
        await mssql.close();
      }
    }),

  /** Tier C apply — sau khi user duyệt graph, upsert vào bảng workflows.
   *  Idempotent: overwriteIfExists=false (default) bảo vệ graph user đã sửa
   *  thủ công trong /workflows/<id>. Set =true mới override. */
  codegenProcWorkflowApply: rbacProcedure("edit", "settings")
    .input(
      z.object({
        module: z.string().min(1).max(80),
        procName: z.string().min(1),
        /** WorkflowDef graph đã duyệt. Cho phép user sửa nodes/edges trước apply. */
        graph: z.object({
          nodes: z.array(z.record(z.string(), z.unknown())),
          edges: z.array(z.record(z.string(), z.unknown())),
        }),
        /** Tên workflow trong hệ thống mới — default = procName sanitize. */
        workflowName: z.string().min(1).optional(),
        /** Khi workflow đã tồn tại:
         *  - false (default): KHÔNG ghi đè, trả về existing ID + reused=true.
         *    Bảo vệ user edits sau khi apply lần đầu.
         *  - true: ghi đè graph. */
        overwriteIfExists: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const name =
        input.workflowName ?? input.procName.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();

      const [existing] = await ctx.db
        .select({ id: workflows.id })
        .from(workflows)
        .where(and(eq(workflows.companyId, ctx.user.companyId), eq(workflows.name, name)))
        .limit(1);

      let workflowId: string;
      let reused = false;
      if (existing) {
        if (!input.overwriteIfExists) {
          // Idempotent: workflow đã tồn tại → reuse, bảo vệ user edits.
          workflowId = existing.id;
          reused = true;
        } else {
          const [r] = await ctx.db
            .update(workflows)
            .set({
              graph: input.graph,
              updatedAt: new Date(),
            })
            .where(eq(workflows.id, existing.id))
            .returning({ id: workflows.id });
          if (!r) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Update fail." });
          workflowId = r.id;
        }
      } else {
        const [r] = await ctx.db
          .insert(workflows)
          .values({
            companyId: ctx.user.companyId,
            name,
            triggerType: "manual",
            triggerConfig: {},
            graph: input.graph,
            isActive: false,
          })
          .returning({ id: workflows.id });
        if (!r) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Insert fail." });
        workflowId = r.id;
      }

      // Đánh dấu manifest proc đã codegen Tier C (only nếu chưa set hoặc thay đổi).
      const p = resolve(MODULES_DIR(), `${input.module}.yaml`);
      if (existsSync(p)) {
        const manifest = YAML.parse(readFileSync(p, "utf8")) as {
          procs?: Array<Record<string, unknown>>;
        };
        const proc = (manifest.procs ?? []).find((pr) => pr.name === input.procName);
        if (
          proc &&
          (proc.targetWorkflowId !== workflowId ||
            proc.targetWorkflowName !== name ||
            proc.suggestedTier !== "C")
        ) {
          proc.targetWorkflowId = workflowId;
          proc.targetWorkflowName = name;
          proc.suggestedTier = "C";
          writeFileSync(p, YAML.stringify(manifest, { lineWidth: 0 }), "utf8");
        }
      }

      // Chỉ log decision khi thật sự ghi DB (không log khi reused = no-op).
      if (!reused) {
        appendDecision({
          module: input.module,
          action: "codegenProcWorkflowApply",
          by: ctx.user.id,
          args: { procName: input.procName, workflowId, workflowName: name },
        });
      }

      return { ok: true, workflowId, workflowName: name, reused };
    }),

  /** User override category cho 1 proc — ghi userOverrideCategory. */
  setProcCategory: rbacProcedure("edit", "settings")
    .input(
      z.object({
        module: z.string().min(1).max(80),
        procName: z.string().min(1),
        category: z
          .enum([
            "create",
            "read",
            "update",
            "delete",
            "report",
            "validation",
            "calculation",
            "workflow",
            "trigger",
            "batch",
            "unknown",
          ])
          .nullable(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const p = resolve(MODULES_DIR(), `${input.module}.yaml`);
      if (!existsSync(p)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Manifest không tồn tại." });
      }
      const manifest = YAML.parse(readFileSync(p, "utf8")) as {
        procs?: Array<Record<string, unknown>>;
      };
      const proc = (manifest.procs ?? []).find((pr) => pr.name === input.procName);
      if (!proc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Proc không có trong manifest." });
      }
      if (input.category === null) {
        delete proc.userOverrideCategory;
      } else {
        proc.userOverrideCategory = input.category;
      }
      writeFileSync(p, YAML.stringify(manifest, { lineWidth: 0 }), "utf8");
      appendDecision({
        module: input.module,
        action: "setProcCategory",
        by: ctx.user.id,
        args: { procName: input.procName, category: input.category },
      });
      return { ok: true };
    }),

  /** Liệt kê entity đã migrate + gợi ý FK (từ proc joinPairs trong manifest). */
  listMigratedRelations: rbacProcedure("edit", "settings")
    .input(
      z.object({
        /** Filter theo module YAML (optional). null = mọi module. */
        module: z.string().min(1).max(80).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Lấy entity có meta.source.kind = "migration"
      const rows = await ctx.db
        .select({
          id: entities.id,
          name: entities.name,
          label: entities.label,
          fields: entities.fields,
          meta: entities.meta,
        })
        .from(entities)
        .where(eq(entities.companyId, ctx.user.companyId));

      const migratedEntities = rows
        .map((r) => {
          const meta = (r.meta ?? {}) as {
            source?: { kind?: string; mssqlTable?: string; module?: string };
          };
          const src = meta.source;
          if (src?.kind !== "migration") return null;
          if (input.module && src.module !== input.module) return null;
          const fields = (r.fields ?? []) as Array<{
            name: string;
            label?: string;
            type: string;
            ref?: string;
          }>;
          return {
            id: r.id,
            name: r.name,
            label: r.label,
            mssqlTable: src.mssqlTable ?? null,
            module: src.module ?? null,
            fields: fields.map((f) => ({
              name: f.name,
              label: f.label ?? f.name,
              type: f.type,
              ref: f.ref ?? null,
            })),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null);

      // Build lookup: mssqlTable → entityId
      const tableToEntity = new Map<string, { id: string; name: string }>();
      for (const e of migratedEntities) {
        if (e.mssqlTable) {
          tableToEntity.set(e.mssqlTable.toLowerCase(), { id: e.id, name: e.name });
        }
      }

      // Đọc inferredRelations từ tất cả manifest YAML (cross-module).
      const hints: Array<{
        sourceEntityId: string;
        sourceEntityName: string;
        sourceField: string;
        targetEntityId: string;
        targetEntityName: string;
        targetField: string;
        fromProc: string;
        module: string;
        applied: boolean;
      }> = [];
      const dir = MODULES_DIR();
      if (existsSync(dir)) {
        const files = readdirSync(dir).filter(
          (f) => f.endsWith(".yaml") && !f.startsWith("_example") && !f.endsWith(".enriched.yaml"),
        );
        for (const f of files) {
          if (input.module && !f.startsWith(`${input.module}.`)) continue;
          try {
            const m = YAML.parse(readFileSync(resolve(dir, f), "utf8")) as {
              tables?: Array<{
                name: string;
                inferredRelations?: Array<{
                  column: string;
                  refTable: string;
                  refColumn: string;
                  sourceProc: string;
                }>;
              }>;
            };
            for (const t of m.tables ?? []) {
              const sourceEntity = tableToEntity.get(t.name.toLowerCase());
              if (!sourceEntity) continue;
              for (const rel of t.inferredRelations ?? []) {
                const targetEntity = tableToEntity.get(rel.refTable.toLowerCase());
                if (!targetEntity) continue;
                // Đã apply nếu field source có .ref = targetEntity.id
                const sourceFieldRow = migratedEntities
                  .find((e) => e.id === sourceEntity.id)
                  ?.fields.find((fld) => fld.name === rel.column);
                const applied = sourceFieldRow?.ref === targetEntity.id;
                hints.push({
                  sourceEntityId: sourceEntity.id,
                  sourceEntityName: sourceEntity.name,
                  sourceField: rel.column,
                  targetEntityId: targetEntity.id,
                  targetEntityName: targetEntity.name,
                  targetField: rel.refColumn,
                  fromProc: rel.sourceProc,
                  module: f.replace(/\.yaml$/, ""),
                  applied,
                });
              }
            }
          } catch {
            /* skip yaml hỏng */
          }
        }
      }

      // Dedup hints theo (sourceEntity, sourceField, targetEntity).
      const seen = new Set<string>();
      const dedupHints = hints.filter((h) => {
        const key = `${h.sourceEntityId}|${h.sourceField}|${h.targetEntityId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return {
        entities: migratedEntities,
        hints: dedupHints,
      };
    }),

  /** Apply 1 hint: set field.ref = targetEntityId trên source entity. */
  applyRelationHint: rbacProcedure("edit", "settings")
    .input(
      z.object({
        sourceEntityId: z.string().uuid(),
        sourceField: z.string().min(1),
        targetEntityId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [ent] = await ctx.db
        .select()
        .from(entities)
        .where(
          and(eq(entities.id, input.sourceEntityId), eq(entities.companyId, ctx.user.companyId)),
        )
        .limit(1);
      if (!ent) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Entity nguồn không tồn tại." });
      }
      const fields = (ent.fields ?? []) as Array<Record<string, unknown>>;
      const field = fields.find((f) => (f.name as string) === input.sourceField);
      if (!field) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Field nguồn không tồn tại." });
      }

      // Idempotent no-op: state đã đúng → return luôn, không ghi DB + không log.
      const currentRef = (field.ref as string | undefined) ?? null;
      if (currentRef === input.targetEntityId) {
        return { ok: true, changed: false };
      }

      if (input.targetEntityId == null) {
        delete field.ref;
      } else {
        // Verify target tồn tại + cùng company.
        const [target] = await ctx.db
          .select({ id: entities.id })
          .from(entities)
          .where(
            and(eq(entities.id, input.targetEntityId), eq(entities.companyId, ctx.user.companyId)),
          )
          .limit(1);
        if (!target) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Entity đích không tồn tại." });
        }
        field.ref = input.targetEntityId;
        // Đổi type sang "lookup" nếu chưa phải lookup/multi-lookup.
        const curType = field.type as string;
        if (curType !== "lookup" && curType !== "multi-lookup") {
          field.type = "lookup";
        }
      }

      await ctx.db
        .update(entities)
        .set({ fields, updatedAt: new Date() })
        .where(eq(entities.id, input.sourceEntityId));

      appendDecision({
        action: "applyRelationHint",
        by: ctx.user.id,
        args: {
          sourceEntityId: input.sourceEntityId,
          sourceField: input.sourceField,
          targetEntityId: input.targetEntityId,
        },
      });

      return { ok: true, changed: true };
    }),

  /** Phân tích câu SQL tùy ý — trích xuất JOIN pairs, map sang entity đã
   *  migrate, trả danh sách gợi ý ref để user xác nhận rồi apply.
   *  Không yêu cầu kết nối MSSQL — chỉ parse text + đọc DB nội bộ. */
  analyzeRelationsFromSql: rbacProcedure("edit", "settings")
    .input(z.object({ sql: z.string().min(1).max(200_000) }))
    .mutation(async ({ ctx, input }) => {
      const { joinPairs } = analyzeProc(input.sql);

      // Load toàn bộ entity công ty — filter migration entity bằng meta.
      const rows = await ctx.db
        .select({
          id: entities.id,
          name: entities.name,
          label: entities.label,
          fields: entities.fields,
          meta: entities.meta,
        })
        .from(entities)
        .where(eq(entities.companyId, ctx.user.companyId));

      // Build lookup: mssqlTable.toLowerCase() → entity info + fields
      const tableToEntity = new Map<
        string,
        {
          id: string;
          name: string;
          label: string;
          fields: Array<{ name: string; label: string; type: string; ref?: string | null }>;
        }
      >();
      for (const r of rows) {
        const meta = (r.meta ?? {}) as { source?: { kind?: string; mssqlTable?: string } };
        const mssqlTable = meta.source?.mssqlTable;
        if (!mssqlTable) continue;
        const fields = (
          (r.fields ?? []) as Array<{ name: string; label?: string; type: string; ref?: string }>
        ).map((f) => ({
          name: f.name,
          label: f.label ?? f.name,
          type: f.type,
          ref: f.ref ?? null,
        }));
        tableToEntity.set(mssqlTable.toLowerCase(), {
          id: r.id,
          name: r.name,
          label: r.label,
          fields,
        });
      }

      // Với mỗi join pair, kiểm tra cả hai chiều: leftTable.leftCol → rightTable
      // và rightTable.rightCol → leftTable. Ưu tiên chiều có field tồn tại.
      type Hint = {
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
      };
      const hints: Hint[] = [];
      const seen = new Set<string>();

      const addHint = (srcTable: string, srcCol: string, tgtTable: string, tgtCol: string) => {
        const src = tableToEntity.get(srcTable.toLowerCase());
        const tgt = tableToEntity.get(tgtTable.toLowerCase());
        if (!src || !tgt) return;
        const srcField = src.fields.find((f) => f.name.toLowerCase() === srcCol.toLowerCase());
        if (!srcField) return;
        const key = `${src.id}|${srcField.name}|${tgt.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        hints.push({
          sourceEntityId: src.id,
          sourceEntityName: src.name,
          sourceEntityLabel: src.label,
          sourceField: srcField.name,
          sourceFieldLabel: srcField.label,
          targetEntityId: tgt.id,
          targetEntityName: tgt.name,
          targetEntityLabel: tgt.label,
          targetField: tgtCol,
          applied: srcField.ref === tgt.id,
        });
      };

      for (const p of joinPairs) {
        addHint(p.leftTable, p.leftColumn, p.rightTable, p.rightColumn);
        addHint(p.rightTable, p.rightColumn, p.leftTable, p.leftColumn);
      }

      return {
        joinPairsTotal: joinPairs.length,
        hints,
        unmappedTables: [
          ...new Set(
            joinPairs
              .flatMap((p) => [p.leftTable, p.rightTable])
              .filter((t) => !tableToEntity.has(t.toLowerCase())),
          ),
        ],
      };
    }),

  /** Kiểm tra công ty có LLM profile kind=chat chưa — dùng để pre-flight check
   *  trước khi chạy classify/codegen, tránh flood log với lỗi no_profile. */
  checkLlmProfile: rbacProcedure("edit", "settings").query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: llmProfiles.id,
        name: llmProfiles.name,
        adapter: llmProfiles.adapter,
        kind: llmProfiles.kind,
      })
      .from(llmProfiles)
      // Pre-flight codegen dùng profile CÔNG TY (server-side) → bỏ profile cá nhân.
      .where(and(eq(llmProfiles.companyId, ctx.user.companyId), isNull(llmProfiles.userId)));
    const p = rows.find((r) => r.kind === "chat");
    return {
      ok: !!p,
      profileName: p?.name ?? null,
      adapter: p?.adapter ?? null,
      companyId: ctx.user.companyId,
      totalProfiles: rows.length,
    };
  }),

  /** Liệt kê Tier D module-proc đã sinh (registry auto-load packages/plugins/module-*). */
  listModuleProcs: rbacProcedure("view", "procedure").query(() => listModuleProcsRegistry()),

  /** Nạp lại registry sau khi codegen sinh/ghi đè thêm file Tier D — tránh phải restart. */
  refreshModuleProcs: rbacProcedure("edit", "settings").mutation(async () => {
    const count = await refreshModuleProcs();
    return { count };
  }),

  /** Gọi 1 Tier D module-proc generic. Gác run/procedure giống procedures.invoke.
   *  Args pass-through — hàm codegen sinh tự validate + cô lập tenant qua company_id. */
  invokeModuleProc: rbacProcedure("run", "procedure")
    .input(
      z.object({
        module: z.string().min(1),
        name: z.string().min(1),
        args: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const entry = await getModuleProc(input.module, input.name);
      if (!entry) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Module-proc "${input.module}/${input.name}" không có trong registry. Đã codegen + apply file chưa? Thử refreshModuleProcs.`,
        });
      }
      const t0 = Date.now();
      try {
        const result = await entry.fn(ctx.db, ctx.user.companyId, input.args ?? {});
        const durationMs = Date.now() - t0;
        await logActivity(ctx.db, {
          companyId: ctx.user.companyId,
          kind: "run_module_proc",
          objectType: "procedure",
          target: `${input.module}/${input.name}`,
          detail: `Tier D chạy ${durationMs}ms`,
          actorUserId: ctx.user.id,
        });
        return { result, durationMs };
      } catch (e) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (e as Error).message });
      }
    }),
});

interface MaterializeOneOpts {
  db: DB;
  companyId: string;
  userId: string;
  client: MssqlClient;
  table: {
    name: string;
    primaryKey?: string[];
    columns?: Array<{ name: string; type: string }>;
  };
  splitRule?: {
    discriminatorColumn: string;
    discriminatorValue: string;
  };
  valueColumn?: string;
  labelColumn?: string;
  extraColumns?: string[];
  limit: number;
  enumName: string;
  enumLabel: string;
  description?: string;
}

/** Sinh 1 enum từ bảng MSSQL (single hoặc 1 phần của split). */
async function materializeOneEnum(opts: MaterializeOneOpts) {
  const cols = opts.table.columns ?? [];
  const colNames = new Set(cols.map((c) => c.name.toLowerCase()));

  // Validate caller-supplied column names qua allowlist bảng.
  const assertCol = (name: string, field: string): string => {
    if (!colNames.has(name.toLowerCase())) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${field} "${name}" không tồn tại trong bảng "${opts.table.name}".`,
      });
    }
    return cols.find((c) => c.name.toLowerCase() === name.toLowerCase())!.name;
  };

  const resolvedValueCol = opts.valueColumn
    ? assertCol(opts.valueColumn, "valueColumn")
    : undefined;
  const resolvedLabelCol = opts.labelColumn
    ? assertCol(opts.labelColumn, "labelColumn")
    : undefined;
  if (opts.extraColumns) {
    for (const c of opts.extraColumns) assertCol(c, "extraColumns");
  }

  const valueCol =
    resolvedValueCol ??
    opts.table.primaryKey?.[0] ??
    cols.find((c) => /char|text|nvarchar|varchar/i.test(c.type))?.name ??
    cols[0]?.name;
  const labelCol =
    resolvedLabelCol ??
    cols.find((c) => /^(name|ten|label|mo_ta|description|nhan)$/i.test(c.name))?.name ??
    cols.find((c) => /name|ten|label|mo_ta/i.test(c.name))?.name ??
    valueCol;
  if (!valueCol) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Không xác định được cột value." });
  }

  // Build WHERE clause cho split — validate discriminatorColumn qua allowlist
  // trước khi interpolate vào SQL identifier (chống injection).
  let where: string | undefined;
  if (opts.splitRule) {
    const safeDiscrimCol = cols.find(
      (c) => c.name.toLowerCase() === opts.splitRule!.discriminatorColumn.toLowerCase(),
    );
    if (!safeDiscrimCol) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `discriminatorColumn "${opts.splitRule.discriminatorColumn}" không tồn tại trong bảng "${opts.table.name}".`,
      });
    }
    // Escape ] thành ]] theo MSSQL bracketed-identifier spec.
    const safeIdent = safeDiscrimCol.name.replace(/]/g, "]]");
    where = `[${safeIdent}] = '${opts.splitRule.discriminatorValue.replace(/'/g, "''")}'`;
  }

  const rows = await opts.client.bulkRead<Record<string, unknown>>(opts.table.name, {
    limit: opts.limit,
    where,
  });

  const cleanValue = (s: unknown): string =>
    String(s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 50);

  const values = rows
    .map((r) => {
      const item: Record<string, unknown> = {
        value: cleanValue(r[valueCol]),
        label: String(r[labelCol!] ?? r[valueCol] ?? "")
          .trim()
          .slice(0, 100),
      };
      // Extra columns → metadata. Bỏ qua nếu giá trị null/undefined.
      if (opts.extraColumns) {
        for (const c of opts.extraColumns) {
          if (r[c] !== null && r[c] !== undefined) item[c] = r[c];
        }
      }
      return item;
    })
    .filter((v) => v.value && v.label);

  if (values.length === 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Không sinh được giá trị enum cho "${opts.enumName}" từ ${rows.length} rows (valueCol=${valueCol}, labelCol=${labelCol}${where ? `, where=${where}` : ""}). Truyền valueColumn/labelColumn tường minh.`,
    });
  }

  const [existing] = await opts.db
    .select({ id: enums.id })
    .from(enums)
    .where(and(eq(enums.companyId, opts.companyId), eq(enums.name, opts.enumName)));

  let row: { id: string };
  if (existing) {
    const [r] = await opts.db
      .update(enums)
      .set({
        label: opts.enumLabel,
        description: opts.description ?? null,
        values,
        updatedAt: new Date(),
      })
      .where(eq(enums.id, existing.id))
      .returning({ id: enums.id });
    if (!r) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Update enum fail." });
    row = r;
  } else {
    const [r] = await opts.db
      .insert(enums)
      .values({
        companyId: opts.companyId,
        name: opts.enumName,
        label: opts.enumLabel,
        description: opts.description ?? null,
        values,
        createdBy: opts.userId,
      })
      .returning({ id: enums.id });
    if (!r) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Insert enum fail." });
    row = r;
  }

  return {
    enumId: row.id,
    enumName: opts.enumName,
    enumLabel: opts.enumLabel,
    valueCount: values.length,
    valueColumn: valueCol,
    labelColumn: labelCol,
    extraColumns: opts.extraColumns ?? [],
    upserted: (existing ? "updated" : "created") as "updated" | "created",
  };
}

/** Mở MssqlClient theo connectionId cụ thể. Caller PHẢI close. */
async function openMssqlById(
  db: DB,
  companyId: string,
  connectionId: string,
): Promise<MssqlClient> {
  const [row] = await db
    .select()
    .from(mssqlConnections)
    .where(and(eq(mssqlConnections.companyId, companyId), eq(mssqlConnections.id, connectionId)))
    .limit(1);
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Connection MSSQL không tồn tại hoặc thuộc company khác.",
    });
  }
  const client = MssqlClient.fromConfig({
    host: row.host,
    port: row.port,
    database: row.database,
    username: row.username,
    password: decryptSecret(row.passwordEnc),
    encrypt: row.encrypt,
    trustServerCert: row.trustServerCert,
    allowWrite: row.allowWrite,
    requestTimeoutMs: 30_000,
  });
  await client.connect();
  return client;
}

/** Mở MssqlClient từ default connection của company. Caller PHẢI close. */
export async function openDefaultMssql(db: DB, companyId: string): Promise<MssqlClient> {
  const [row] = await db
    .select()
    .from(mssqlConnections)
    .where(and(eq(mssqlConnections.companyId, companyId), eq(mssqlConnections.isDefault, true)))
    .limit(1);
  if (!row) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Chưa có connection MSSQL mặc định — vào Settings → Migration để thêm.",
    });
  }
  const client = MssqlClient.fromConfig({
    host: row.host,
    port: row.port,
    database: row.database,
    username: row.username,
    password: decryptSecret(row.passwordEnc),
    encrypt: row.encrypt,
    trustServerCert: row.trustServerCert,
    allowWrite: row.allowWrite,
    requestTimeoutMs: 30_000,
  });
  await client.connect();
  return client;
}
