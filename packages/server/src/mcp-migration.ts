/* ==========================================================
   mcp-migration.ts — MCP server (JSON-RPC over HTTP) cho module Migration.

   Mục tiêu: cho AI kết nối, đọc trạng thái đồng bộ DQHF→ERP (delta-sync
   + full-import) và schema entity (storage tier, field mapping) để phân
   tích, phát hiện lỗi, gợi ý tối ưu. Tool ghi giới hạn ở thao tác AN TOÀN
   + idempotent (bật agentSearchable, rename bảng promote) — KHÔNG có tool
   import/promote/delete data.

   Endpoint: POST /mcp/migration   (JSON-RPC 2.0)
   Auth:     header X-API-Key (api_keys), scope:
     - migration:read   → tool đọc
     - migration:apply  → tool ghi (kèm quyền đọc)
     - "*" / "migration:*" → toàn quyền migration
   Deny-by-default: scope rỗng = không gì.
   ========================================================== */
import {
  entities,
  migrationFullJobs,
  migrationFullJobTables,
  migrationSyncModules,
  migrationSyncRuns,
  migrationSyncTables,
  mssqlConnections,
} from "@erp-framework/db";
import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { authApiKey } from "./api-key-auth";
import type { DB } from "./db";
import { dropTableForEntity, renamePromotedTablesForCompany } from "./entity-promote";
import type { EntityStorage } from "./entity-table-ddl";
import { createFullImportJob, type FullJobItem } from "./migration-full-import";
import { enqueueMigrationJob } from "./migration-worker";
import { isHybridTablesEnabled } from "./record-store";

/* ── Scope helper ───────────────────────────────────────────── */
export function hasMigrationScope(scopes: string[], level: "read" | "apply" = "read"): boolean {
  if (scopes.includes("*") || scopes.includes("migration:*")) return true;
  // apply = thao tác ghi (bật agentSearchable, rename bảng) — chỉ migration:apply.
  if (level === "apply") return scopes.includes("migration:apply");
  // read = apply bao luôn read.
  return scopes.includes("migration:read") || scopes.includes("migration:apply");
}

/* ── Lỗi tool ───────────────────────────────────────────────── */
class McpError extends Error {
  code: number;
  constructor(message: string, code = -32602) {
    super(message);
    this.code = code;
  }
}

/* ── Tool definitions ───────────────────────────────────────── */
interface ToolDef {
  name: string;
  description: string;
  level: "read" | "apply";
  inputSchema: Record<string, unknown>;
}

const TOOLS: ToolDef[] = [
  {
    name: "migration_list_modules",
    description:
      "Liệt kê các module delta-sync (MSSQL→PG) của công ty. Trả: module name, enabled, " +
      "heartbeatAt (null=không có job đang chạy), createdAt. Dùng để xem module nào đang " +
      "hoạt động, module nào bị kẹt (heartbeat stale > 10 phút).",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          description: "Lọc theo trạng thái bật/tắt (bỏ qua = lấy hết)",
        },
      },
    },
  },
  {
    name: "migration_get_module",
    description:
      "Lấy chi tiết 1 module delta-sync: danh sách bảng (tableName, mode, status, " +
      "pendingChanges, ctLastVersion, insertsCount, updatesCount, deletesCount, " +
      "lastSyncedAt, lastError). Dùng để chẩn đoán bảng bị lỗi hoặc lag cao.",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        module: { type: "string", description: "Tên module, vd 'mes_dinhmuc'" },
      },
      required: ["module"],
    },
  },
  {
    name: "migration_list_runs",
    description:
      "Lịch sử các lần sync gần nhất của 1 module (mặc định 50 run). " +
      "Trả: module, tableName, startedAt, durationMs, inserts, updates, deletes, error. " +
      "Dùng để xem trend lag, tần suất lỗi, hiệu năng mỗi chu kỳ.",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        module: { type: "string", description: "Tên module" },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 200,
          description: "Số run trả về (mặc định 50)",
        },
      },
      required: ["module"],
    },
  },
  {
    name: "migration_list_full_jobs",
    description:
      "Liệt kê các job full-import (seed dữ liệu ban đầu). Trả: id, status, " +
      "totalTables, completedTables, totalRowsImported, startedAt, completedAt, error. " +
      "Dùng để kiểm tra tiến độ seed trước khi bật delta-sync.",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["queued", "running", "completed", "failed", "paused"],
          description: "Lọc theo trạng thái (bỏ qua = lấy hết, sort mới nhất trước)",
        },
        limit: { type: "number", minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: "migration_get_full_job",
    description:
      "Chi tiết 1 job full-import kèm tiến độ từng bảng: tableName, entityName, " +
      "rowsImported, status, lastPk, srcCount, tgtCount, reconcile (ok|drift|skip|null), error. " +
      "Dùng để xác định bảng nào bị kẹt hoặc drift sau import.",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "UUID job (lấy từ migration_list_full_jobs)" },
      },
      required: ["jobId"],
    },
  },
  {
    name: "entity_list",
    description:
      "Liệt kê entity của công ty cùng metadata migration: tên, label, " +
      "storageTier (eav|table), tableName (nếu là bảng thật), fieldCount, " +
      "agentSearchable, syncState (nếu có module sync gắn). " +
      "Dùng để xem entity nào đã promote thành bảng thật, entity nào đang được sync.",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        storageTier: {
          type: "string",
          enum: ["eav", "table"],
          description: "Lọc theo storage tier (bỏ qua = lấy hết)",
        },
      },
    },
  },
  {
    name: "entity_get",
    description:
      "Chi tiết 1 entity: fields (name, type, label, required, indexed), " +
      "meta.storage (tier, tableName), meta.sync (state, module, lastSyncedAt). " +
      "Dùng để kiểm tra field mapping và trạng thái sync của entity cụ thể.",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Tên kỹ thuật của entity (vd 'dinh_muc_go_van')",
        },
        id: {
          type: "string",
          description: "Hoặc UUID entity (ưu tiên hơn name nếu có cả 2)",
        },
      },
    },
  },
  {
    name: "migration_list_connections",
    description:
      "Liệt kê kết nối MSSQL đã cấu hình: id, name, host, port, database, isDefault. " +
      "Không trả password. Dùng để biết connectionId khi gọi các tool khác.",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "entity_set_agent_searchable",
    description:
      "BẬT/TẮT cho phép agent AI tra cứu entity qua tool records_search " +
      "(meta.agentSearchable, deny-by-default). Truyền danh sách tên entity + enabled. " +
      "Trả kết quả từng entity (ok | not_found).",
    level: "apply",
    inputSchema: {
      type: "object",
      properties: {
        names: {
          type: "array",
          items: { type: "string" },
          description: "Tên kỹ thuật các entity (vd ['san_pham_ab9208'])",
        },
        enabled: { type: "boolean", description: "true = cho agent tra cứu" },
      },
      required: ["names", "enabled"],
    },
  },
  {
    name: "migration_rename_promoted_tables",
    description:
      "Đổi tên các bảng thật đã promote (er_<hash>) sang đúng tên bảng DB cũ " +
      "(meta.source.mssqlTable). Idempotent: bỏ qua mục đã đúng tên / trùng tên / " +
      "không có nguồn. Trả danh sách kết quả (renamed | skip | error) từng bảng.",
    level: "apply",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "migration_export_entities",
    description:
      "Xuất TOÀN BỘ entity import từ MSSQL (có meta.source.mssqlTable) kèm label entity + " +
      "label từng field + recordCount — dùng làm BACKUP trước khi xoá và làm items cho " +
      "migration_start_full_import (label giữ nguyên, không cần enrich lại). " +
      "Kèm danh sách entity KHÔNG có nguồn (sẽ được giữ lại khi xoá).",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "migration_delete_imported_entities",
    description:
      "XOÁ vĩnh viễn các entity import theo danh sách tên. GUARD: chỉ xoá entity có " +
      "meta.source.mssqlTable (entity tạo tay bị từ chối — skipped_no_source). " +
      "Entity tier=table: DROP bảng thật + dọn locator trước. Cascade xoá entity_records, " +
      "saved_views, templates... Trả kết quả từng entity (deleted | skipped_no_source | not_found).",
    level: "apply",
    inputSchema: {
      type: "object",
      properties: {
        names: {
          type: "array",
          items: { type: "string" },
          maxItems: 200,
          description: "Tên kỹ thuật các entity cần xoá (danh sách đã được duyệt)",
        },
      },
      required: ["names"],
    },
  },
  {
    name: "migration_start_full_import",
    description:
      "Tạo job full-import từ MSSQL. items = [{tableName, entityName, label, fields:[{name,label,type}]}] " +
      "(lấy từ migration_export_entities). targetTier='table' → import thẳng vào bảng thật " +
      "mang tên DB cũ (cần ERP_HYBRID_TABLES=1). Trả jobId — theo dõi bằng migration_get_full_job. " +
      "Worker stream theo PK, tự resume khi lỗi mạng.",
    level: "apply",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: { type: "string", description: "UUID kết nối MSSQL" },
        items: {
          type: "array",
          minItems: 1,
          maxItems: 200,
          items: {
            type: "object",
            properties: {
              tableName: { type: "string", description: "vd 'dbo.tr_sanpham'" },
              entityName: { type: "string", description: "^[a-z][a-z0-9_]*$" },
              label: { type: "string" },
              fields: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    label: { type: "string" },
                    type: { type: "string" },
                  },
                  required: ["name", "label", "type"],
                },
              },
            },
            required: ["tableName", "entityName", "label", "fields"],
          },
        },
        targetTier: { type: "string", enum: ["eav", "table"] },
        batchSize: { type: "number", minimum: 100, maximum: 50000 },
      },
      required: ["connectionId", "items"],
    },
  },
];

/* ── Tool handlers ──────────────────────────────────────────── */
function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

type StorageMeta = { tier?: string; tableName?: string };
type SyncMeta = {
  state?: string;
  module?: string;
  lastSyncedAt?: string;
};
type EntityMeta = { storage?: StorageMeta; sync?: SyncMeta; agentSearchable?: boolean };

async function callMigrationTool(
  db: DB,
  companyId: string,
  scopes: string[],
  apiKeyCreatedBy: string | null,
  name: string,
  rawArgs: unknown,
): Promise<unknown> {
  const args = asObj(rawArgs);

  // Tool ghi yêu cầu scope migration:apply (deny-by-default).
  const def = TOOLS.find((t) => t.name === name);
  if (def?.level === "apply" && !hasMigrationScope(scopes, "apply")) {
    throw new McpError("Thiếu scope migration:apply cho tool ghi.", -32602);
  }

  switch (name) {
    /* ── migration_list_modules ─────────────────────────────── */
    case "migration_list_modules": {
      const rows = await db
        .select({
          id: migrationSyncModules.id,
          module: migrationSyncModules.module,
          enabled: migrationSyncModules.enabled,
          cronExpr: migrationSyncModules.cronExpr,
          heartbeatAt: migrationSyncModules.heartbeatAt,
          createdAt: migrationSyncModules.createdAt,
          updatedAt: migrationSyncModules.updatedAt,
          connectionId: migrationSyncModules.connectionId,
        })
        .from(migrationSyncModules)
        .where(
          and(
            eq(migrationSyncModules.companyId, companyId),
            args.enabled != null
              ? eq(migrationSyncModules.enabled, args.enabled as boolean)
              : undefined,
          ),
        )
        .orderBy(migrationSyncModules.module);

      // Tính stale: heartbeat > 10 phút → khả năng job crash.
      const now = Date.now();
      return rows.map((r) => ({
        ...r,
        heartbeatStale:
          r.heartbeatAt != null && now - new Date(r.heartbeatAt).getTime() > 10 * 60 * 1000,
      }));
    }

    /* ── migration_get_module ───────────────────────────────── */
    case "migration_get_module": {
      const module = String(args.module ?? "");
      if (!module) throw new McpError("module bắt buộc");

      const [mod] = await db
        .select()
        .from(migrationSyncModules)
        .where(
          and(
            eq(migrationSyncModules.companyId, companyId),
            eq(migrationSyncModules.module, module),
          ),
        );
      if (!mod) throw new McpError(`Module '${module}' không tồn tại`, -32602);

      const tables = await db
        .select({
          id: migrationSyncTables.id,
          tableName: migrationSyncTables.tableName,
          entityId: migrationSyncTables.entityId,
          mode: migrationSyncTables.mode,
          enabled: migrationSyncTables.enabled,
          status: migrationSyncTables.status,
          ctLastVersion: migrationSyncTables.ctLastVersion,
          srcCurrentVersion: migrationSyncTables.srcCurrentVersion,
          pendingChanges: migrationSyncTables.pendingChanges,
          insertsCount: migrationSyncTables.insertsCount,
          updatesCount: migrationSyncTables.updatesCount,
          deletesCount: migrationSyncTables.deletesCount,
          lastSyncedAt: migrationSyncTables.lastSyncedAt,
          lastError: migrationSyncTables.lastError,
        })
        .from(migrationSyncTables)
        .where(
          and(eq(migrationSyncTables.companyId, companyId), eq(migrationSyncTables.module, module)),
        )
        .orderBy(migrationSyncTables.tableName);

      return {
        module: mod,
        tables,
        summary: {
          total: tables.length,
          idle: tables.filter((t) => t.status === "idle").length,
          error: tables.filter((t) => t.status === "error").length,
          reseedRequired: tables.filter((t) => t.status === "reseed_required").length,
          totalPendingChanges: tables.reduce((s, t) => s + (t.pendingChanges ?? 0), 0),
        },
      };
    }

    /* ── migration_list_runs ────────────────────────────────── */
    case "migration_list_runs": {
      const module = String(args.module ?? "");
      if (!module) throw new McpError("module bắt buộc");
      const limit = Math.min(Number(args.limit ?? 50), 200);

      return db
        .select({
          id: migrationSyncRuns.id,
          module: migrationSyncRuns.module,
          tableName: migrationSyncRuns.tableName,
          startedAt: migrationSyncRuns.startedAt,
          finishedAt: migrationSyncRuns.finishedAt,
          durationMs: migrationSyncRuns.durationMs,
          inserts: migrationSyncRuns.inserts,
          updates: migrationSyncRuns.updates,
          deletes: migrationSyncRuns.deletes,
          error: migrationSyncRuns.error,
        })
        .from(migrationSyncRuns)
        .where(
          and(eq(migrationSyncRuns.companyId, companyId), eq(migrationSyncRuns.module, module)),
        )
        .orderBy(desc(migrationSyncRuns.startedAt))
        .limit(limit);
    }

    /* ── migration_list_full_jobs ───────────────────────────── */
    case "migration_list_full_jobs": {
      const limit = Math.min(Number(args.limit ?? 20), 50);
      return db
        .select({
          id: migrationFullJobs.id,
          status: migrationFullJobs.status,
          kind: migrationFullJobs.kind,
          totalTables: migrationFullJobs.totalTables,
          completedTables: migrationFullJobs.completedTables,
          totalRowsImported: migrationFullJobs.totalRowsImported,
          startedAt: migrationFullJobs.startedAt,
          completedAt: migrationFullJobs.completedAt,
          error: migrationFullJobs.error,
          createdAt: migrationFullJobs.createdAt,
        })
        .from(migrationFullJobs)
        .where(
          and(
            eq(migrationFullJobs.companyId, companyId),
            args.status ? eq(migrationFullJobs.status, args.status as string) : undefined,
          ),
        )
        .orderBy(desc(migrationFullJobs.createdAt))
        .limit(limit);
    }

    /* ── migration_get_full_job ─────────────────────────────── */
    case "migration_get_full_job": {
      const jobId = String(args.jobId ?? "");
      if (!jobId) throw new McpError("jobId bắt buộc");

      const [job] = await db
        .select()
        .from(migrationFullJobs)
        .where(and(eq(migrationFullJobs.id, jobId), eq(migrationFullJobs.companyId, companyId)));
      if (!job) throw new McpError(`Job '${jobId}' không tồn tại`, -32602);

      const tables = await db
        .select({
          id: migrationFullJobTables.id,
          tableName: migrationFullJobTables.tableName,
          entityName: migrationFullJobTables.entityName,
          pkColumn: migrationFullJobTables.pkColumn,
          lastPk: migrationFullJobTables.lastPk,
          rowsImported: migrationFullJobTables.rowsImported,
          batchSize: migrationFullJobTables.batchSize,
          status: migrationFullJobTables.status,
          srcCount: migrationFullJobTables.srcCount,
          tgtCount: migrationFullJobTables.tgtCount,
          reconcile: migrationFullJobTables.reconcile,
          error: migrationFullJobTables.error,
          updatedAt: migrationFullJobTables.updatedAt,
        })
        .from(migrationFullJobTables)
        .where(eq(migrationFullJobTables.jobId, jobId))
        .orderBy(migrationFullJobTables.tableName);

      return { job, tables };
    }

    /* ── entity_list ────────────────────────────────────────── */
    case "entity_list": {
      const rows = await db
        .select({
          id: entities.id,
          name: entities.name,
          label: entities.label,
          icon: entities.icon,
          meta: entities.meta,
          fields: sql<number>`jsonb_array_length(${entities.fields})`.as("field_count"),
          updatedAt: entities.updatedAt,
        })
        .from(entities)
        .where(eq(entities.companyId, companyId))
        .orderBy(entities.name);

      return rows
        .map((r) => {
          const meta = (r.meta ?? {}) as EntityMeta;
          const tier = meta.storage?.tier ?? "eav";
          return {
            id: r.id,
            name: r.name,
            label: r.label,
            icon: r.icon,
            storageTier: tier,
            tableName: meta.storage?.tableName,
            fieldCount: r.fields,
            agentSearchable: meta.agentSearchable ?? false,
            syncState: meta.sync?.state,
            syncModule: meta.sync?.module,
            syncLastAt: meta.sync?.lastSyncedAt,
            updatedAt: r.updatedAt,
          };
        })
        .filter((r) => !args.storageTier || r.storageTier === args.storageTier);
    }

    /* ── entity_get ─────────────────────────────────────────── */
    case "entity_get": {
      const entityName = String(args.name ?? "");
      const entityId = String(args.id ?? "");
      if (!entityName && !entityId) throw new McpError("name hoặc id bắt buộc");

      const [row] = await db
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.companyId, companyId),
            entityId
              ? eq(entities.id, entityId)
              : sql`lower(${entities.name}) = lower(${entityName})`,
          ),
        );
      if (!row) {
        throw new McpError(
          `Entity '${entityName || entityId}' không tồn tại trong công ty`,
          -32602,
        );
      }

      const meta = (row.meta ?? {}) as EntityMeta;
      return {
        id: row.id,
        name: row.name,
        label: row.label,
        icon: row.icon,
        fields: row.fields,
        storageTier: meta.storage?.tier ?? "eav",
        tableName: meta.storage?.tableName,
        agentSearchable: meta.agentSearchable ?? false,
        sync: meta.sync ?? null,
        updatedAt: row.updatedAt,
      };
    }

    /* ── migration_list_connections ─────────────────────────── */
    case "migration_list_connections": {
      return db
        .select({
          id: mssqlConnections.id,
          name: mssqlConnections.name,
          host: mssqlConnections.host,
          port: mssqlConnections.port,
          database: mssqlConnections.database,
          username: mssqlConnections.username,
          encrypt: mssqlConnections.encrypt,
          trustServerCert: mssqlConnections.trustServerCert,
          allowWrite: mssqlConnections.allowWrite,
          isDefault: mssqlConnections.isDefault,
          createdAt: mssqlConnections.createdAt,
        })
        .from(mssqlConnections)
        .where(eq(mssqlConnections.companyId, companyId))
        .orderBy(mssqlConnections.name);
    }

    /* ── entity_set_agent_searchable (apply) ────────────────── */
    case "entity_set_agent_searchable": {
      const names = Array.isArray(args.names) ? args.names.map(String) : [];
      const enabled = args.enabled === true;
      if (names.length === 0) throw new McpError("names bắt buộc (mảng tên entity)");
      if (names.length > 50) throw new McpError("Tối đa 50 entity mỗi lần");

      const results: Array<{ name: string; status: "ok" | "not_found" }> = [];
      for (const entityName of names) {
        // Merge jsonb — KHÔNG ghi đè meta (giữ storage/source/sync, bài học #20).
        const updated = await db
          .update(entities)
          .set({
            meta: sql`coalesce(${entities.meta}, '{}'::jsonb) || ${JSON.stringify({ agentSearchable: enabled })}::jsonb`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(entities.companyId, companyId),
              sql`lower(${entities.name}) = lower(${entityName})`,
            ),
          )
          .returning({ id: entities.id });
        results.push({ name: entityName, status: updated.length > 0 ? "ok" : "not_found" });
      }
      return { enabled, results };
    }

    /* ── migration_rename_promoted_tables (apply) ───────────── */
    case "migration_rename_promoted_tables": {
      if (!isHybridTablesEnabled()) {
        throw new McpError("Cần bật ERP_HYBRID_TABLES=1 trên server.", -32603);
      }
      return renamePromotedTablesForCompany(db, companyId);
    }

    /* ── migration_export_entities (read) ───────────────────── */
    case "migration_export_entities": {
      const rows = await db
        .select()
        .from(entities)
        .where(eq(entities.companyId, companyId))
        .orderBy(entities.name);

      const imported: Array<Record<string, unknown>> = [];
      const kept: Array<{ name: string; label: string; storageTier: string }> = [];

      for (const e of rows) {
        const meta = (e.meta ?? {}) as EntityMeta & {
          source?: { mssqlTable?: string; connectionId?: string };
        };
        const tier = meta.storage?.tier ?? "eav";
        if (!meta.source?.mssqlTable) {
          kept.push({ name: e.name, label: e.label, storageTier: tier });
          continue;
        }
        // Đếm record: bảng thật → COUNT bảng; EAV → COUNT entity_records.
        let recordCount = 0;
        try {
          if (tier === "table" && meta.storage?.tableName) {
            const r = (await db.execute(
              sql`SELECT count(*)::int AS n FROM ${sql.raw(`"${meta.storage.tableName}"`)} WHERE company_id = ${companyId}::uuid`,
            )) as unknown as Array<{ n: number }> | { rows: Array<{ n: number }> };
            const list = Array.isArray(r) ? r : (r.rows ?? []);
            recordCount = Number(list[0]?.n ?? 0);
          } else {
            const r = (await db.execute(
              sql`SELECT count(*)::int AS n FROM entity_records WHERE company_id = ${companyId}::uuid AND entity_id = ${e.id}::uuid`,
            )) as unknown as Array<{ n: number }> | { rows: Array<{ n: number }> };
            const list = Array.isArray(r) ? r : (r.rows ?? []);
            recordCount = Number(list[0]?.n ?? 0);
          }
        } catch {
          recordCount = -1; // đếm lỗi (bảng đã drop?) — không chặn export
        }
        imported.push({
          entityId: e.id,
          name: e.name,
          label: e.label,
          mssqlTable: meta.source.mssqlTable,
          connectionId: meta.source.connectionId,
          fields: e.fields,
          storageTier: tier,
          tableName: meta.storage?.tableName,
          agentSearchable: meta.agentSearchable ?? false,
          recordCount,
        });
      }
      return { imported, importedCount: imported.length, kept, keptCount: kept.length };
    }

    /* ── migration_delete_imported_entities (apply) ─────────── */
    case "migration_delete_imported_entities": {
      const names = Array.isArray(args.names) ? args.names.map(String) : [];
      if (names.length === 0) throw new McpError("names bắt buộc (mảng tên entity)");
      if (names.length > 200) throw new McpError("Tối đa 200 entity mỗi lần");

      const results: Array<{
        name: string;
        status: "deleted" | "skipped_no_source" | "not_found";
        droppedTable?: string;
      }> = [];
      for (const entityName of names) {
        const [e] = await db
          .select({ id: entities.id, meta: entities.meta })
          .from(entities)
          .where(
            and(
              eq(entities.companyId, companyId),
              sql`lower(${entities.name}) = lower(${entityName})`,
            ),
          );
        if (!e) {
          results.push({ name: entityName, status: "not_found" });
          continue;
        }
        const meta = (e.meta ?? {}) as EntityMeta & { source?: { mssqlTable?: string } };
        // GUARD: chỉ xoá entity import (có nguồn MSSQL) — entity tạo tay từ chối.
        if (!meta.source?.mssqlTable) {
          results.push({ name: entityName, status: "skipped_no_source" });
          continue;
        }
        let droppedTable: string | undefined;
        if (meta.storage?.tier === "table" && meta.storage.tableName) {
          await dropTableForEntity(db, companyId, e.id, meta.storage as EntityStorage);
          droppedTable = meta.storage.tableName;
        }
        await db
          .delete(entities)
          .where(and(eq(entities.id, e.id), eq(entities.companyId, companyId)));
        results.push({ name: entityName, status: "deleted", droppedTable });
      }
      return {
        results,
        deleted: results.filter((r) => r.status === "deleted").length,
      };
    }

    /* ── migration_start_full_import (apply) ────────────────── */
    case "migration_start_full_import": {
      if (!apiKeyCreatedBy) {
        throw new McpError(
          "API key không có người tạo (created_by null) — không xác định được createdBy cho job. Tạo key mới từ tài khoản admin.",
          -32603,
        );
      }
      const connectionId = String(args.connectionId ?? "");
      if (!connectionId) throw new McpError("connectionId bắt buộc");
      const rawItems = Array.isArray(args.items) ? args.items : [];
      if (rawItems.length === 0) throw new McpError("items bắt buộc (>=1 bảng)");
      if (rawItems.length > 200) throw new McpError("Tối đa 200 bảng mỗi job");

      const items: FullJobItem[] = rawItems.map((it) => {
        const o = asObj(it);
        const entityName = String(o.entityName ?? "");
        if (!/^[a-z][a-z0-9_]*$/.test(entityName)) {
          throw new McpError(`entityName "${entityName}" sai định dạng (^[a-z][a-z0-9_]*$)`);
        }
        const fields = (Array.isArray(o.fields) ? o.fields : []).map((f) => {
          const fo = asObj(f);
          return {
            name: String(fo.name ?? ""),
            label: String(fo.label ?? fo.name ?? ""),
            type: String(fo.type ?? "text"),
          };
        });
        return {
          tableName: String(o.tableName ?? ""),
          entityName,
          label: String(o.label ?? entityName),
          fields,
        };
      });

      const targetTier = args.targetTier === "table" ? ("table" as const) : ("eav" as const);
      if (targetTier === "table" && !isHybridTablesEnabled()) {
        throw new McpError("targetTier=table cần ERP_HYBRID_TABLES=1 trên server.", -32603);
      }
      const batchSize = Math.min(Math.max(Number(args.batchSize ?? 5_000), 100), 50_000);

      const { jobId } = await createFullImportJob(db, companyId, apiKeyCreatedBy, {
        connectionId,
        items,
        batchSize,
        targetTier,
      });
      await enqueueMigrationJob({
        action: "full-import",
        module: jobId,
        args: {},
        userId: apiKeyCreatedBy,
        companyId,
      });
      return { jobId, tables: items.length, targetTier, batchSize };
    }

    default:
      throw new McpError(`Tool chưa cài đặt: ${name}`, -32601);
  }
}

/* ── JSON-RPC handler ───────────────────────────────────────── */
interface JsonRpcReq {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

export function registerMigrationMcp(app: FastifyInstance, db: DB): void {
  app.post("/mcp/migration", async (req, reply) => {
    const auth = await authApiKey(db, req);
    if (!auth) return reply.code(401).send({ error: "Invalid API key" });
    if (!hasMigrationScope(auth.scopes)) {
      return reply.code(403).send({ error: "Thiếu scope migration:read" });
    }

    const body = (req.body ?? {}) as JsonRpcReq;
    const id = body.id ?? null;
    const method = body.method;

    const ok = (result: unknown) => reply.send({ jsonrpc: "2.0", id, result });
    const fail = (code: number, message: string) =>
      reply.send({ jsonrpc: "2.0", id, error: { code, message } });

    try {
      switch (method) {
        case "initialize":
          return ok({
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "erp-migration", version: "1.0.0" },
          });
        case "notifications/initialized":
          return reply.code(204).send();
        case "ping":
          return ok({});
        case "tools/list":
          return ok({
            tools: TOOLS.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          });
        case "tools/call": {
          const p = asObj(body.params);
          const name = String(p.name ?? "");
          const data = await callMigrationTool(
            db,
            auth.companyId,
            auth.scopes,
            auth.createdBy ?? null,
            name,
            p.arguments,
          );
          return ok({
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          });
        }
        default:
          return fail(-32601, `Method không hỗ trợ: ${method ?? "?"}`);
      }
    } catch (e) {
      if (e instanceof McpError) return fail(e.code, e.message);
      console.error("[mcp/migration] lỗi:", e);
      return fail(-32603, (e as Error).message || "Lỗi nội bộ");
    }
  });
}
