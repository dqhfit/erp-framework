/* ==========================================================
   migration-router.ts — tRPC endpoints cho UI migration MSSQL.
   - listModules / getModule           — đọc manifest YAML
   - startJob(action, module, args)    — enqueue pg-boss, return jobId
   - jobStatus(jobId)                  — polling fallback (WS là chính)
   - aiLog(module) / getAiLogEntry     — list + xem prompt-response của LLM
   - envCheck                          — kiểm tra env (MSSQL/DB/LLM)
   Toàn bộ rbacProcedure("edit","settings") — admin only.
   ========================================================== */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import YAML from "yaml";
import { mssqlConnections, enums } from "@erp-framework/db";
import { MssqlClient } from "@erp-framework/mssql-client";
import {
  enrichOneProc,
  normalizeNames,
  codegenProc,
  generateProcSamples,
  auditModule,
  type ProcSample,
} from "@erp-framework/migration-cli/enrich";
import { procedures } from "@erp-framework/db";
import { mkdirSync } from "node:fs";
import { runDiscover } from "@erp-framework/migration-cli/discover";
import { rbacProcedure, router } from "./trpc";
import { decryptSecret } from "./crypto";
import { enqueueMigrationJob, getMigrationJobStatus } from "./migration-worker";
import type { DB } from "./db";

const MIGRATION_ROOT = () => resolve(process.cwd(), "migration-plan");
const MODULES_DIR = () => resolve(MIGRATION_ROOT(), "modules");
const AI_LOG_DIR = () => resolve(MIGRATION_ROOT(), "ai-log");
const DECISIONS_FILE = () => resolve(MIGRATION_ROOT(), "decisions.yaml");

/** Ghi log mọi thay đổi manifest vào decisions.yaml shared cross-module.
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
  arr.push({ at: new Date().toISOString(), ...entry });
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

const ACTION_VALUES = [
  "discover",
  "enrich",
  "capture-golden",
  "generate",
  "data",
  "audit",
] as const;
const moduleNameSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, "Module name phải snake_case");

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
      if (input.action === "generate" || input.action === "audit") {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message: `Action "${input.action}" thuộc Tier 2/4 — chưa triển khai.`,
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
    .query(async ({ input }) => {
      return getMigrationJobStatus(input.jobId);
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
        discoverParams?: { seedTables: string[]; excludeTables: string[]; maxTables: number };
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
      const allowedPluginBase = resolve(process.cwd(), "packages", "plugins");
      for (const proc of procs) {
        if (!proc.targetFile) continue;
        const fullPath = resolve(process.cwd(), proc.targetFile);
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
          const filePath = resolve(process.cwd(), proc.targetFile);
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
          tierC: procs.filter((p) => p.tier === "C").length,
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

  /** Kết thúc module: chuyển phase sang "live" + ghi cutoverAt. */
  finalizeModule: rbacProcedure("edit", "settings")
    .input(
      z.object({
        module: moduleNameSchema,
        force: z.boolean().default(false),
      }),
    )
    .mutation(({ input, ctx }) => {
      const p = resolve(MODULES_DIR(), `${input.module}.yaml`);
      if (!existsSync(p)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Manifest không tồn tại." });
      }
      const m = YAML.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
      const status = (m.status as Record<string, unknown> | undefined) ?? {};
      status.phase = "live";
      status.cutoverAt = new Date().toISOString();
      status.cutoverBy = ctx.user.id;
      m.status = status;
      writeFileSync(p, YAML.stringify(m, { lineWidth: 0 }), "utf8");
      appendDecision({
        module: input.module,
        action: { type: "finalizeModule", force: input.force },
        by: ctx.user.id,
      });
      return { ok: true, phase: "live" as const, cutoverAt: status.cutoverAt as string };
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
    .input(z.object({ module: moduleNameSchema, procName: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const client = await openDefaultMssql(ctx.db, ctx.user.companyId);
      try {
        return await codegenProc({
          module: input.module,
          procName: input.procName,
          mssqlClient: client,
          companyId: ctx.user.companyId,
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
   */
  codegenProcApply: rbacProcedure("edit", "settings")
    .input(
      z.object({
        module: moduleNameSchema,
        tier: z.enum(["B", "D"]),
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
      if (input.tier === "B") {
        if (!input.name || !input.label) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Tier B cần name + label" });
        }
        const [existing] = await ctx.db
          .select({ id: procedures.id })
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
        if (existing) {
          await ctx.db.update(procedures).set(values).where(eq(procedures.id, existing.id));
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
          })
          .returning({ id: procedures.id });
        if (!row)
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Insert procedure fail." });
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
      const pluginDir = resolve(process.cwd(), "packages", "plugins", `module-${input.module}`);
      mkdirSync(pluginDir, { recursive: true });
      const target = resolve(pluginDir, input.fileName);
      // Safety: target phải nằm trong pluginDir (+ sep tránh prefix-match partial dir).
      if (!target.startsWith(pluginDir + sep)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Path không hợp lệ." });
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
      writeFileSync(target, input.code, "utf8");
      return {
        tier: "D" as const,
        filePath: target,
        upserted: fileExists ? ("overwritten" as const) : ("created" as const),
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
    .input(z.object({ procName: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const client = await openDefaultMssql(ctx.db, ctx.user.companyId);
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

/** Mở MssqlClient từ default connection của company. Caller PHẢI close. */
async function openDefaultMssql(db: DB, companyId: string): Promise<MssqlClient> {
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
