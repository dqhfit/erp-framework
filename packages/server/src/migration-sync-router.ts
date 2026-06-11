/* ==========================================================
   migration-sync-router.ts — tRPC endpoints cho delta-sync MSSQL→PG.
   Mount vào router.ts tại key "migrationSync".

   Nhóm endpoint:
   - listSyncModules / getSyncModuleDetail  — đọc trạng thái
   - checkCtStatus                          — CT trạng thái trên MSSQL
   - generateCtEnableScript                 — sinh script SQL cho DBA
   - enableModuleSync / disableModuleSync   — bật/tắt sync
   - setSyncTableMode                       — chuyển ct/rescan/manual per-bảng
   - runModuleSyncNow                       — chạy 1 chu kỳ ngay
   - cutoverChecklist / executeCutover / rollbackCutover — P6
   ========================================================== */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import {
  entities,
  migrationSyncModules,
  migrationSyncRuns,
  migrationSyncTables,
  mssqlConnections,
} from "@erp-framework/db";
import { MssqlClient } from "@erp-framework/mssql-client";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import YAML from "yaml";
import { z } from "zod";
import { decryptSecret } from "./crypto";
import { db } from "./db";
import {
  countDestActiveRows,
  enableModuleSyncForCompany,
  runDeltaSyncRun,
  seedSyncTable,
} from "./migration-delta-sync";
import { appendDecision, moduleNameSchema } from "./migration-router";
import { rbacProcedure, router } from "./trpc";

const MODULES_DIR = () => resolve(process.cwd(), "migration-plan", "modules");

/** Đọc manifest module + đếm proc active đã codegen nhưng chưa verify golden
 *  (cùng quy tắc gate với finalizeModule). Trả null nếu manifest không có.
 *  GUARD path traversal: module phải snake_case + path resolve phải nằm
 *  trong MODULES_DIR (bài học #15 — so prefix bằng base + sep). */
function readManifestProcGate(module: string): {
  phase: string | undefined;
  unverified: string[];
  manifest: Record<string, unknown>;
  path: string;
} | null {
  if (!/^[a-z][a-z0-9_]*$/.test(module)) return null;
  const base = resolve(MODULES_DIR());
  const p = resolve(base, `${module}.yaml`);
  if (!p.startsWith(base + sep)) return null;
  if (!existsSync(p)) return null;
  const m = YAML.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  const procs = (m.procs as Array<Record<string, unknown>> | undefined) ?? [];
  const unverified = procs
    .filter(
      (pr) =>
        pr.active !== false &&
        pr.suggestedTier !== "A" &&
        pr.suggestedTier !== "C" &&
        (pr.targetProcName || pr.targetFile) &&
        !pr.verifiedAt,
    )
    .map((pr) => String(pr.name ?? ""));
  const phase = (m.status as { phase?: string } | undefined)?.phase;
  return { phase, unverified, manifest: m, path: p };
}

/* ─── Helper: load MssqlClient từ connectionId ─── */

async function loadClientForCompany(companyId: string, connectionId: string): Promise<MssqlClient> {
  const [row] = await db
    .select()
    .from(mssqlConnections)
    .where(and(eq(mssqlConnections.id, connectionId), eq(mssqlConnections.companyId, companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Connection không tồn tại." });
  const client = MssqlClient.fromConfig({
    host: row.host,
    port: row.port,
    database: row.database,
    username: row.username,
    password: decryptSecret(row.passwordEnc),
    encrypt: row.encrypt,
    trustServerCert: row.trustServerCert,
    allowWrite: false,
    requestTimeoutMs: 30_000,
  });
  await client.connect();
  return client;
}

/* ─── Router ─── */

export const migrationSyncRouter = router({
  /** Liệt kê tất cả module sync của company, kèm summary bảng. */
  listSyncModules: rbacProcedure("edit", "settings").query(async ({ ctx }) => {
    const mods = await db
      .select()
      .from(migrationSyncModules)
      .where(eq(migrationSyncModules.companyId, ctx.user.companyId))
      .orderBy(migrationSyncModules.module);

    const tables = await db
      .select()
      .from(migrationSyncTables)
      .where(eq(migrationSyncTables.companyId, ctx.user.companyId))
      .orderBy(migrationSyncTables.module, migrationSyncTables.tableName);

    const tablesByModule = new Map<string, typeof tables>();
    for (const t of tables) {
      if (!tablesByModule.has(t.module)) tablesByModule.set(t.module, []);
      tablesByModule.get(t.module)?.push(t);
    }

    return mods.map((m) => ({
      ...m,
      tables: tablesByModule.get(m.module) ?? [],
    }));
  }),

  /** Chi tiết 1 module + lịch sử 20 run gần nhất. */
  getSyncModuleDetail: rbacProcedure("edit", "settings")
    .input(z.object({ module: moduleNameSchema, connectionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [mod] = await db
        .select()
        .from(migrationSyncModules)
        .where(
          and(
            eq(migrationSyncModules.companyId, ctx.user.companyId),
            eq(migrationSyncModules.connectionId, input.connectionId),
            eq(migrationSyncModules.module, input.module),
          ),
        )
        .limit(1);
      if (!mod) throw new TRPCError({ code: "NOT_FOUND", message: "Module sync không tồn tại." });

      const tables = await db
        .select()
        .from(migrationSyncTables)
        .where(
          and(
            eq(migrationSyncTables.companyId, ctx.user.companyId),
            eq(migrationSyncTables.module, input.module),
          ),
        );

      const runs = await db
        .select()
        .from(migrationSyncRuns)
        .where(
          and(
            eq(migrationSyncRuns.companyId, ctx.user.companyId),
            eq(migrationSyncRuns.module, input.module),
          ),
        )
        .orderBy(desc(migrationSyncRuns.startedAt))
        .limit(20);

      return { mod, tables, runs };
    }),

  /** Kiểm tra trạng thái Change Tracking trên MSSQL cho 1 connection. */
  checkCtStatus: rbacProcedure("edit", "settings")
    .input(
      z.object({
        connectionId: z.string().uuid(),
        schemaTables: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const client = await loadClientForCompany(ctx.user.companyId, input.connectionId);
      try {
        return await client.getCtStatus(input.schemaTables);
      } finally {
        await client.close().catch(() => undefined);
      }
    }),

  /** Sinh script SQL DBA chạy để bật CT trên DB + từng bảng.
   *  Framework KHÔNG tự chạy write trên MSSQL — DBA chạy tay. */
  generateCtEnableScript: rbacProcedure("edit", "settings")
    .input(
      z.object({
        connectionId: z.string().uuid(),
        schemaTables: z.array(z.string()),
        retentionDays: z.number().int().min(1).max(30).default(7),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Lấy tên DB.
      const [conn] = await db
        .select({ database: mssqlConnections.database })
        .from(mssqlConnections)
        .where(
          and(
            eq(mssqlConnections.id, input.connectionId),
            eq(mssqlConnections.companyId, ctx.user.companyId),
          ),
        )
        .limit(1);
      if (!conn) throw new TRPCError({ code: "NOT_FOUND", message: "Connection không tồn tại." });

      const lines: string[] = [
        `-- Script bat Change Tracking cho database ${conn.database}`,
        `-- Chay tren MSSQL voi quyen ALTER DATABASE + ALTER TABLE.`,
        `-- Kiem tra lai sau khi chay: checkCtStatus.`,
        ``,
        `-- 1. Bat CT cap database (retention ${input.retentionDays} ngay).`,
        `ALTER DATABASE [${conn.database}]`,
        `  SET CHANGE_TRACKING = ON`,
        `  (CHANGE_RETENTION = ${input.retentionDays} DAYS, AUTO_CLEANUP = ON);`,
        ``,
        `-- 2. Bat CT tung bang.`,
      ];

      for (const st of input.schemaTables) {
        const parts = st.includes(".") ? st.split(".") : ["dbo", st];
        const escaped = `[${(parts[0] ?? "dbo").replace(/]/g, "]]")}].[${(parts[1] ?? st).replace(/]/g, "]]")}]`;
        lines.push(
          `ALTER TABLE ${escaped} ENABLE CHANGE_TRACKING WITH (TRACK_COLUMNS_UPDATED = OFF);`,
        );
      }

      return { script: lines.join("\n") };
    }),

  /** Bật sync cho 1 module: tạo rows migration_sync_tables từ manifest ∩
   *  entity đã import + đặt meta.sync.state='mirror' cho các entity đó.
   *  Idempotent: bảng đã có row thì skip. */
  enableModuleSync: rbacProcedure("edit", "settings")
    .input(
      z.object({
        connectionId: z.string().uuid(),
        module: moduleNameSchema,
        cronExpr: z.string().default("*/5 * * * *"),
        tables: z.array(
          z.object({
            tableName: z.string(),
            pkColumn: z.string().optional(),
            mode: z.enum(["ct", "rescan", "manual"]).default("ct"),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Logic chung với MCP /mcp/migration (enableModuleSyncForCompany).
      try {
        const r = await enableModuleSyncForCompany(ctx.user.companyId, ctx.user.id, input);
        return { modId: r.modId, created: r.created };
      } catch (e) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (e as Error).message });
      }
    }),

  /** Tắt sync cho 1 module (không xoá bảng sync_tables). */
  disableModuleSync: rbacProcedure("edit", "settings")
    .input(z.object({ connectionId: z.string().uuid(), module: moduleNameSchema }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(migrationSyncModules)
        .set({ enabled: false, updatedAt: new Date() })
        .where(
          and(
            eq(migrationSyncModules.companyId, ctx.user.companyId),
            eq(migrationSyncModules.connectionId, input.connectionId),
            eq(migrationSyncModules.module, input.module),
          ),
        );
      return { ok: true };
    }),

  /** Đổi mode sync per-bảng (ct/rescan/manual). */
  setSyncTableMode: rbacProcedure("edit", "settings")
    .input(
      z.object({
        syncTableId: z.string().uuid(),
        mode: z.enum(["ct", "rescan", "manual"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await db
        .update(migrationSyncTables)
        .set({ mode: input.mode, updatedAt: new Date() })
        .where(
          and(
            eq(migrationSyncTables.id, input.syncTableId),
            eq(migrationSyncTables.companyId, ctx.user.companyId),
          ),
        );
      return { ok: true };
    }),

  /** Trigger seed 1 bảng cụ thể (rescan + capture CT baseline). */
  seedSyncTable: rbacProcedure("edit", "settings")
    .input(z.object({ syncTableId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership.
      const [t] = await db
        .select({ companyId: migrationSyncTables.companyId })
        .from(migrationSyncTables)
        .where(eq(migrationSyncTables.id, input.syncTableId))
        .limit(1);
      if (!t || t.companyId !== ctx.user.companyId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Sync table không tồn tại." });
      }
      return seedSyncTable({ syncTableId: input.syncTableId, userId: ctx.user.id });
    }),

  /** Chạy 1 chu kỳ sync ngay (không chờ cron). */
  runModuleSyncNow: rbacProcedure("edit", "settings")
    .input(z.object({ connectionId: z.string().uuid(), module: moduleNameSchema }))
    .mutation(async ({ ctx, input }) => {
      return runDeltaSyncRun({
        companyId: ctx.user.companyId,
        connectionId: input.connectionId,
        module: input.module,
        userId: ctx.user.id,
      });
    }),

  /* ── P6: Cutover per module ── */

  /** Pre-check tự động trước cutover. */
  cutoverChecklist: rbacProcedure("edit", "settings")
    .input(z.object({ connectionId: z.string().uuid(), module: moduleNameSchema }))
    .query(async ({ ctx, input }) => {
      const tables = await db
        .select()
        .from(migrationSyncTables)
        .where(
          and(
            eq(migrationSyncTables.companyId, ctx.user.companyId),
            eq(migrationSyncTables.connectionId, input.connectionId),
            eq(migrationSyncTables.module, input.module),
          ),
        );

      const checks: Array<{ id: string; label: string; pass: boolean; detail?: string }> = [];

      // Bảng enabled và không lỗi.
      const errTables = tables.filter(
        (t) => t.status === "error" || t.status === "reseed_required",
      );
      checks.push({
        id: "no_error_tables",
        label: "Không có bảng lỗi",
        pass: errTables.length === 0,
        detail:
          errTables.length > 0
            ? `${errTables.map((t) => t.tableName).join(", ")} cần sửa.`
            : undefined,
      });

      // Lag nhỏ: pending_changes ~ 0.
      const highLagTables = tables.filter((t) => (t.pendingChanges ?? 0) > 100);
      checks.push({
        id: "low_lag",
        label: "Lag thấp (pending < 100)",
        pass: highLagTables.length === 0,
        detail:
          highLagTables.length > 0
            ? `${highLagTables.map((t) => `${t.tableName}(${t.pendingChanges})`).join(", ")} còn tồn đọng.`
            : undefined,
      });

      // Bảng manual cần kế hoạch.
      const manualTables = tables.filter((t) => t.mode === "manual");
      checks.push({
        id: "manual_plan",
        label: "Bảng manual đã có kế hoạch",
        pass: manualTables.length === 0,
        detail:
          manualTables.length > 0
            ? `${manualTables.map((t) => t.tableName).join(", ")} cần copy thủ công trong cửa sổ freeze.`
            : undefined,
      });

      // Đã sync gần đây (< 15 phút).
      const staleThreshold = new Date(Date.now() - 15 * 60 * 1000);
      const staleTables = tables.filter(
        (t) =>
          t.enabled && t.mode !== "manual" && (!t.lastSyncedAt || t.lastSyncedAt < staleThreshold),
      );
      checks.push({
        id: "recent_sync",
        label: "Sync gần đây (< 15 phút)",
        pass: staleTables.length === 0,
        detail:
          staleTables.length > 0
            ? `${staleTables.map((t) => t.tableName).join(", ")} chưa sync gần đây.`
            : undefined,
      });

      // Bảng mode=ct đã seed (có watermark) — chưa seed = mất rows trước CT.
      const unseededTables = tables.filter(
        (t) => t.enabled && t.mode === "ct" && t.ctLastVersion == null,
      );
      checks.push({
        id: "seeded",
        label: "Bảng CT đã seed (có watermark)",
        pass: unseededTables.length === 0,
        detail:
          unseededTables.length > 0
            ? `${unseededTables.map((t) => t.tableName).join(", ")} chưa seed — chạy seed hoặc 1 chu kỳ sync.`
            : undefined,
      });

      // Proc active đã codegen phải verify golden (cùng gate finalizeModule).
      const gate = readManifestProcGate(input.module);
      checks.push({
        id: "procs_verified",
        label: "Proc active đã verify golden",
        pass: gate === null || gate.phase === "live" || gate.unverified.length === 0,
        detail:
          gate && gate.phase !== "live" && gate.unverified.length > 0
            ? `${gate.unverified.slice(0, 8).join(", ")}${gate.unverified.length > 8 ? "…" : ""} chưa verify — chạy verifyModuleProcs hoặc finalizeModule force.`
            : undefined,
      });

      const allPass = checks.every((c) => c.pass);
      return { checks, allPass };
    }),

  /** Thực hiện cutover 1 module.
   *  Bước 1-N: caller đã freeze DQHF module + confirm checkbox.
   *  Server: final sync → verify → flip mirror→live → disable sync. */
  executeCutover: rbacProcedure("edit", "settings")
    .input(
      z.object({
        connectionId: z.string().uuid(),
        module: moduleNameSchema,
        /** Checkbox user đã confirm "Đã khoá module trên DQHF". */
        confirmedDqhfFrozen: z.literal(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Final sync trước khi flip. PHẢI kiểm tra kết quả: skipped (lock
      // đang bị chu kỳ cron giữ) hoặc error mà vẫn flip = mất change cuối.
      const finalSync = await runDeltaSyncRun({
        companyId: ctx.user.companyId,
        connectionId: input.connectionId,
        module: input.module,
        userId: ctx.user.id,
      });
      if (finalSync.skipped) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Chu kỳ sync khác đang chạy (lock đang giữ) — final sync chưa thực hiện được. Thử lại sau ít phút.",
        });
      }
      if (finalSync.error) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Final sync lỗi: ${finalSync.error}. Sửa lỗi rồi cutover lại.`,
        });
      }

      // Lấy danh sách bảng + entity.
      const tables = await db
        .select()
        .from(migrationSyncTables)
        .where(
          and(
            eq(migrationSyncTables.companyId, ctx.user.companyId),
            eq(migrationSyncTables.connectionId, input.connectionId),
            eq(migrationSyncTables.module, input.module),
          ),
        );

      // Verify: không bảng nào lỗi/cần reseed sau final sync, và không còn
      // pending version. (Per-table error trong final sync KHÔNG nổi lên
      // finalSync.error — phải check status từng bảng.)
      const errTables = tables.filter(
        (t) => t.enabled && (t.status === "error" || t.status === "reseed_required"),
      );
      if (errTables.length > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Bảng lỗi trong final sync: ${errTables.map((t) => t.tableName).join(", ")}. Sửa rồi cutover lại.`,
        });
      }
      const notReady = tables.filter((t) => (t.pendingChanges ?? 0) > 0);
      if (notReady.length > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Còn ${notReady.map((t) => t.tableName).join(", ")} chưa sync hết. Thử lại sau.`,
        });
      }

      // Gate proc verify (cùng quy tắc finalizeModule). Phase đã live =
      // admin đã finalize (kể cả force + reason) → không chặn lại.
      const gate = readManifestProcGate(input.module);
      if (gate && gate.phase !== "live" && gate.unverified.length > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            `${gate.unverified.length} proc active chưa verify golden: ` +
            `${gate.unverified.slice(0, 8).join(", ")}. ` +
            `Chạy verifyModuleProcs, hoặc finalizeModule force=true trước khi cutover.`,
        });
      }

      // Verify count nguồn-vs-đích per bảng (DQHF đã freeze nên count ổn định).
      const verifyClient = await loadClientForCompany(ctx.user.companyId, input.connectionId);
      const mismatches: string[] = [];
      try {
        for (const t of tables) {
          if (!t.entityId) continue;
          const srcCount = await verifyClient.countRows(t.tableName);
          const dstCount = await countDestActiveRows(t);
          if (dstCount !== null && srcCount !== dstCount) {
            mismatches.push(`${t.tableName} (nguon ${srcCount} / dich ${dstCount})`);
          }
        }
      } finally {
        await verifyClient.close().catch(() => undefined);
      }
      if (mismatches.length > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Count lệch nguồn-đích: ${mismatches.join("; ")}. Điều tra trước khi cutover.`,
        });
      }

      // Flip meta.sync.state='live' + disable sync.
      for (const t of tables) {
        if (t.entityId) {
          await db
            .update(entities)
            .set({
              meta: sql`coalesce(${entities.meta}, '{}'::jsonb) || '{"sync":{"state":"live"}}'::jsonb`,
              updatedAt: new Date(),
            })
            .where(eq(entities.id, t.entityId));
        }
        await db
          .update(migrationSyncTables)
          .set({ status: "cutover", enabled: false, updatedAt: new Date() })
          .where(eq(migrationSyncTables.id, t.id));
      }

      // Tắt module.
      await db
        .update(migrationSyncModules)
        .set({ enabled: false, updatedAt: new Date() })
        .where(
          and(
            eq(migrationSyncModules.companyId, ctx.user.companyId),
            eq(migrationSyncModules.connectionId, input.connectionId),
            eq(migrationSyncModules.module, input.module),
          ),
        );

      // Manifest: set phase=live + cutoverAt (nếu chưa live) + decision log.
      if (gate && gate.phase !== "live") {
        const status = (gate.manifest.status as Record<string, unknown> | undefined) ?? {};
        status.phase = "live";
        status.cutoverAt = new Date().toISOString();
        status.cutoverBy = ctx.user.id;
        gate.manifest.status = status;
        writeFileSync(gate.path, YAML.stringify(gate.manifest, { lineWidth: 0 }), "utf8");
      }
      appendDecision({
        module: input.module,
        action: { type: "executeCutover", tables: tables.length },
        by: ctx.user.id,
      });

      return { ok: true, flippedTables: tables.length };
    }),

  /** Rollback cutover: flip live → mirror + re-enable sync. */
  rollbackCutover: rbacProcedure("edit", "settings")
    .input(z.object({ connectionId: z.string().uuid(), module: moduleNameSchema }))
    .mutation(async ({ ctx, input }) => {
      const tables = await db
        .select()
        .from(migrationSyncTables)
        .where(
          and(
            eq(migrationSyncTables.companyId, ctx.user.companyId),
            eq(migrationSyncTables.connectionId, input.connectionId),
            eq(migrationSyncTables.module, input.module),
            eq(migrationSyncTables.status, "cutover"),
          ),
        );

      for (const t of tables) {
        if (t.entityId) {
          await db
            .update(entities)
            .set({
              meta: sql`coalesce(${entities.meta}, '{}'::jsonb) || '{"sync":{"state":"mirror"}}'::jsonb`,
              updatedAt: new Date(),
            })
            .where(eq(entities.id, t.entityId));
        }
        await db
          .update(migrationSyncTables)
          .set({ status: "idle", enabled: true, updatedAt: new Date() })
          .where(eq(migrationSyncTables.id, t.id));
      }

      await db
        .update(migrationSyncModules)
        .set({ enabled: true, updatedAt: new Date() })
        .where(
          and(
            eq(migrationSyncModules.companyId, ctx.user.companyId),
            eq(migrationSyncModules.connectionId, input.connectionId),
            eq(migrationSyncModules.module, input.module),
          ),
        );

      // Manifest: phase live → filled + decision log (dữ liệu user đã ghi
      // vào ERP trong cửa sổ live xem qua record_audit để nhập lại DQHF).
      const gate = readManifestProcGate(input.module);
      if (gate && gate.phase === "live") {
        const status = (gate.manifest.status as Record<string, unknown> | undefined) ?? {};
        status.phase = "filled";
        gate.manifest.status = status;
        writeFileSync(gate.path, YAML.stringify(gate.manifest, { lineWidth: 0 }), "utf8");
      }
      appendDecision({
        module: input.module,
        action: { type: "rollbackCutover", tables: tables.length },
        by: ctx.user.id,
      });

      return { ok: true, restoredTables: tables.length };
    }),
});
