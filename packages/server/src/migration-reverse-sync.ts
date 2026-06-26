/* ==========================================================
   migration-reverse-sync.ts — Reverse replica PG → MSSQL (sau cutover,
   MSSQL chỉ-đọc). Mirror NGƯỢC của migration-delta-sync.ts.

   Kiến trúc:
   - runReverseSyncRun({companyId,connectionId,module,userId}): 1 chu kỳ.
     Gọi từ migration-worker.ts action='reverse-sync' (pg-boss) + cron jobs.ts.
   - enableReplicaForCompany(...): đăng ký bảng replica (chỉ entity state='live').
   - seedReverseTable(...): backfill toàn bộ active rows + set watermark t0.

   Nguyên tắc (KHÁC forward — không atomic xuyên 2 DB):
   - Phát hiện thay đổi PG: keyset (updated_at, id) + safety lag (chống
     transaction in-flight). Bảng thật luôn bump updated_at mọi ghi.
   - at-least-once + idempotent MERGE: ghi MSSQL TRƯỚC, persist watermark SAU.
     Crash giữa chừng → chu kỳ sau re-đọc + MERGE lại vô hại.
   - deleted_at IS NOT NULL → DELETE (hard) / set cờ (soft) bên MSSQL.
   - Reverse mapping = đảo proc-table listWhere: fieldName = lower(cột MSSQL)
     → ghi theo fieldName (MSSQL case-insensitive). Loại cột hệ thống ERP.
   - CHỈ replica entity meta.sync.state='live' AND replicaToMssql=true (fail-closed).
   - Mọi method ghi MssqlClient requireWrite() → connection PHẢI allowWrite=true.
   ========================================================== */

import {
  entities,
  migrationReverseModules,
  migrationReverseSync,
  migrationSyncRuns,
} from "@erp-framework/db";
import type { ColumnInfo, MssqlClient } from "@erp-framework/mssql-client";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "./db";
import type { EntityStorage } from "./entity-table-ddl";
import { loadConn } from "./migration-full-import";
import { publish as publishWs } from "./ws-hub";

/* ─── Types ─── */
export interface ReverseSyncResult {
  upserts: number;
  deletes: number;
  tablesRun: number;
  skipped?: boolean;
  error?: string;
}

type ReverseRow = typeof migrationReverseSync.$inferSelect;

const SYSTEM_FIELDS = new Set([
  "id",
  "company_id",
  "version",
  "deleted_at",
  "search_tsv",
  "rollup_cache",
  "rollup_invalidated",
  "created_by",
  "ext",
]);

/** Ident PG an toàn (regex chặt) trước khi nội suy raw vào SQL. */
function assertIdent(ident: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(ident)) {
    throw new Error(`Identifier không an toàn: "${ident}"`);
  }
  return ident;
}

/* ─── Heartbeat lock (mirror forward, trên migration_reverse_modules) ─── */
async function claimHeartbeat(moduleId: string): Promise<Date | null> {
  const stale = new Date(Date.now() - 10 * 60 * 1000);
  const token = new Date();
  const claimed = await db
    .update(migrationReverseModules)
    .set({ heartbeatAt: token, updatedAt: token })
    .where(
      and(
        eq(migrationReverseModules.id, moduleId),
        or(
          isNull(migrationReverseModules.heartbeatAt),
          lt(migrationReverseModules.heartbeatAt, stale),
        ),
      ),
    )
    .returning({ id: migrationReverseModules.id });
  return claimed.length > 0 ? token : null;
}

async function refreshHeartbeat(moduleId: string, token: Date): Promise<Date | null> {
  const next = new Date();
  const r = await db
    .update(migrationReverseModules)
    .set({ heartbeatAt: next, updatedAt: next })
    .where(
      and(eq(migrationReverseModules.id, moduleId), eq(migrationReverseModules.heartbeatAt, token)),
    )
    .returning({ id: migrationReverseModules.id });
  return r.length > 0 ? next : null;
}

async function releaseHeartbeat(moduleId: string, token: Date): Promise<void> {
  await db
    .update(migrationReverseModules)
    .set({ heartbeatAt: null, updatedAt: new Date() })
    .where(
      and(eq(migrationReverseModules.id, moduleId), eq(migrationReverseModules.heartbeatAt, token)),
    );
}

/* ─── Reverse mapping (đảo listWhere): PG physical row → row keyed fieldName ─── */
interface MappedRow {
  /** Row MSSQL (chỉ field nằm trong allowedCols), keyed theo fieldName. */
  mssqlRow: Record<string, unknown>;
  deleted: boolean;
  pgId: string;
  pgUpdatedAt: Date;
}

export function buildMssqlRowFromTableRow(
  storage: EntityStorage,
  pgRow: Record<string, unknown>,
  allowedCols: Set<string>,
): MappedRow {
  const data: Record<string, unknown> = {};
  // ext jsonb → field keys (lowercase).
  const ext = (pgRow.ext as Record<string, unknown> | null) ?? {};
  for (const [k, v] of Object.entries(ext)) {
    const lk = k.toLowerCase();
    if (allowedCols.has(lk)) data[lk] = v;
  }
  // Cột typed → fieldName (map ngược qua storage.columns).
  for (const [field, m] of Object.entries(storage.columns)) {
    const lk = field.toLowerCase();
    if (!allowedCols.has(lk)) continue;
    const v = pgRow[m.col];
    data[lk] = m.pgType === "numeric" && v != null ? Number(v) : (v ?? null);
  }
  return {
    mssqlRow: data,
    deleted: pgRow.deleted_at != null,
    pgId: String(pgRow.id),
    pgUpdatedAt: pgRow.updated_at as Date,
  };
}

/* ─── Đọc 1 batch PG theo keyset (updated_at, id) + lag ─── */
async function readPgBatch(
  tableName: string,
  companyId: string,
  wmUpdatedAt: Date | null,
  wmId: string | null,
  lagSeconds: number,
  limit: number,
): Promise<Array<Record<string, unknown>>> {
  const tbl = sql.raw(`"${assertIdent(tableName)}"`);
  const lagClause = sql`updated_at <= now() - (${lagSeconds} * interval '1 second')`;
  const keyset =
    wmUpdatedAt == null
      ? sql`TRUE`
      : sql`(updated_at > ${wmUpdatedAt} OR (updated_at = ${wmUpdatedAt} AND id > ${wmId}::uuid))`;
  const res = await db.execute(sql`
    SELECT * FROM ${tbl}
    WHERE company_id = ${companyId}::uuid AND ${keyset} AND ${lagClause}
    ORDER BY updated_at ASC, id ASC
    LIMIT ${limit}
  `);
  return (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<
    Record<string, unknown>
  >;
}

/* ─── Load entity storage + sync state (guard live + replica) ─── */
interface EntityCtx {
  storage: EntityStorage;
  syncState: string | null;
  replicaToMssql: boolean;
}
async function loadEntityCtx(entityId: string, companyId: string): Promise<EntityCtx | null> {
  const [row] = await db
    .select({ meta: entities.meta })
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.companyId, companyId)))
    .limit(1);
  if (!row) return null;
  const meta = row.meta as {
    storage?: EntityStorage;
    sync?: { state?: string; replicaToMssql?: boolean };
  } | null;
  const storage = meta?.storage;
  if (!storage || storage.tier !== "table" || !storage.tableName) return null;
  return {
    storage,
    syncState: meta?.sync?.state ?? null,
    replicaToMssql: meta?.sync?.replicaToMssql === true,
  };
}

/* ─── 1 chu kỳ reverse-sync cho 1 module ─── */
export async function runReverseSyncRun(opts: {
  companyId: string;
  connectionId: string;
  module: string;
  userId?: string | null;
}): Promise<ReverseSyncResult> {
  const { companyId, connectionId, module } = opts;
  const [mod] = await db
    .select()
    .from(migrationReverseModules)
    .where(
      and(
        eq(migrationReverseModules.companyId, companyId),
        eq(migrationReverseModules.connectionId, connectionId),
        eq(migrationReverseModules.module, module),
      ),
    )
    .limit(1);
  if (!mod || !mod.enabled) return { upserts: 0, deletes: 0, tablesRun: 0, skipped: true };
  const userId = opts.userId ?? mod.createdBy ?? null;

  const token = await claimHeartbeat(mod.id);
  if (!token) return { upserts: 0, deletes: 0, tablesRun: 0, skipped: true }; // đang chạy

  let heartbeat: Date | null = token;
  let totalUp = 0;
  let totalDel = 0;
  let tablesRun = 0;
  let client: MssqlClient | null = null;
  try {
    client = await loadConn(companyId, connectionId);
    const tables = await db
      .select()
      .from(migrationReverseSync)
      .where(
        and(
          eq(migrationReverseSync.companyId, companyId),
          eq(migrationReverseSync.connectionId, connectionId),
          eq(migrationReverseSync.module, module),
          eq(migrationReverseSync.enabled, true),
        ),
      );

    for (const t of tables) {
      if (heartbeat) heartbeat = await refreshHeartbeat(mod.id, heartbeat);
      if (!heartbeat) break; // lock bị steal (stale) → abort an toàn
      const started = Date.now();
      try {
        const stats = await syncOneTable(client, companyId, t);
        totalUp += stats.upserts;
        totalDel += stats.deletes;
        tablesRun++;
        await db.insert(migrationSyncRuns).values({
          companyId,
          connectionId,
          module,
          tableName: t.mssqlTable,
          direction: "reverse",
          startedAt: new Date(started),
          finishedAt: new Date(),
          durationMs: Date.now() - started,
          inserts: stats.upserts,
          updates: 0,
          deletes: stats.deletes,
        });
      } catch (e) {
        const msg = (e as Error).message;
        await db
          .update(migrationReverseSync)
          .set({ status: "error", lastError: msg, updatedAt: new Date() })
          .where(eq(migrationReverseSync.id, t.id));
        await db.insert(migrationSyncRuns).values({
          companyId,
          connectionId,
          module,
          tableName: t.mssqlTable,
          direction: "reverse",
          finishedAt: new Date(),
          durationMs: Date.now() - started,
          error: msg,
        });
      }
    }
    if (userId) {
      publishWs(`migration:${userId}`, {
        kind: "reverse-progress",
        module,
        upserts: totalUp,
        deletes: totalDel,
        tablesRun,
      });
    }
    return { upserts: totalUp, deletes: totalDel, tablesRun };
  } finally {
    await client?.close().catch(() => {});
    if (heartbeat) await releaseHeartbeat(mod.id, heartbeat);
  }
}

/* ─── Đẩy 1 bảng (keyset loop) ─── */
async function syncOneTable(
  client: MssqlClient,
  companyId: string,
  t: ReverseRow,
): Promise<{ upserts: number; deletes: number }> {
  if (!t.entityId) throw new Error(`reverse-sync: bảng "${t.mssqlTable}" thiếu entity_id`);
  const ctx = await loadEntityCtx(t.entityId, companyId);
  if (!ctx) throw new Error(`reverse-sync: entity ${t.entityId} không phải bảng thật`);
  // Fail-closed: chỉ replica entity đã cutover (live) + bật cờ replica.
  if (ctx.syncState !== "live" || !ctx.replicaToMssql) {
    await db
      .update(migrationReverseSync)
      .set({ status: "paused", updatedAt: new Date() })
      .where(eq(migrationReverseSync.id, t.id));
    return { upserts: 0, deletes: 0 };
  }

  // Introspect bảng MSSQL đích 1 lần → columnTypes + cột thật + PK.
  const [schema, ...rest] = t.mssqlTable.replace(/\[|\]/g, "").split(".");
  const bare = rest.length ? rest.join(".") : (schema ?? "");
  const tableInfo = await client.getTable(rest.length ? (schema ?? "dbo") : "dbo", bare);
  if (!tableInfo) throw new Error(`reverse-sync: không đọc được schema MSSQL "${t.mssqlTable}"`);
  const columnTypes = new Map<string, ColumnInfo>(
    tableInfo.columns.map((c) => [c.name.toLowerCase(), c]),
  );
  const mssqlCols = new Set(tableInfo.columns.map((c) => c.name.toLowerCase()));
  // allowedCols = giao(field entity, cột MSSQL) trừ field hệ thống ERP.
  const allowedCols = new Set<string>();
  for (const field of Object.keys(ctx.storage.columns)) {
    const lk = field.toLowerCase();
    if (mssqlCols.has(lk) && !SYSTEM_FIELDS.has(lk)) allowedCols.add(lk);
  }
  // ext field cũng có thể nằm trong cột MSSQL — quét runtime ở buildMssqlRow.
  // Bổ sung: ext key thường khớp cột MSSQL → cho phép mọi cột MSSQL (trừ system).
  for (const c of mssqlCols) if (!SYSTEM_FIELDS.has(c)) allowedCols.add(c);
  const pkLc = t.pkField.toLowerCase();
  if (!mssqlCols.has(pkLc))
    throw new Error(`reverse-sync: PK "${t.pkField}" không có ở MSSQL đích`);

  await db
    .update(migrationReverseSync)
    .set({ status: "running", updatedAt: new Date() })
    .where(eq(migrationReverseSync.id, t.id));

  let wmUpdatedAt = t.wmUpdatedAt;
  let wmId = t.wmId;
  let upserts = 0;
  let deletes = 0;
  const BATCH = 500;
  while (true) {
    const rows = await readPgBatch(
      ctx.storage.tableName,
      companyId,
      wmUpdatedAt,
      wmId,
      t.lagSeconds,
      BATCH,
    );
    if (rows.length === 0) break;

    const toUpsert: Array<Record<string, unknown>> = [];
    const toDeleteKeys: Array<Record<string, unknown>> = [];
    let lastUpdatedAt: Date = wmUpdatedAt ?? new Date(0);
    let lastId: string | null = wmId;
    for (const pg of rows) {
      const m = buildMssqlRowFromTableRow(ctx.storage, pg, allowedCols);
      lastUpdatedAt = m.pgUpdatedAt;
      lastId = m.pgId;
      const pkVal = m.mssqlRow[pkLc];
      if (pkVal == null) continue; // bất biến IDENTITY_INSERT: bỏ row thiếu PK gốc
      if (m.deleted) {
        toDeleteKeys.push({ [t.pkField]: pkVal });
      } else {
        toUpsert.push(m.mssqlRow);
      }
    }

    // Ghi MSSQL TRƯỚC (upsert rồi delete) — at-least-once.
    if (toUpsert.length > 0) {
      const cols = [...allowedCols].filter((c) => mssqlCols.has(c));
      const r = await client.upsertRows({
        schemaTable: t.mssqlTable,
        keyColumns: [t.pkField],
        columns: cols,
        rows: toUpsert,
        columnTypes,
        identityInsert: t.identityInsert,
      });
      upserts += r.inserted + r.updated;
    }
    if (toDeleteKeys.length > 0) {
      if (t.deleteMode === "soft" && t.softDeleteCol) {
        deletes += await client.softFlagRows({
          schemaTable: t.mssqlTable,
          keyColumns: [t.pkField],
          softDeleteCol: t.softDeleteCol,
          flagValue: true,
          keys: toDeleteKeys,
          columnTypes,
        });
      } else {
        deletes += await client.deleteRows({
          schemaTable: t.mssqlTable,
          keyColumns: [t.pkField],
          keys: toDeleteKeys,
          columnTypes,
        });
      }
    }

    // Persist watermark SAU (chỉ khi ghi MSSQL OK).
    wmUpdatedAt = lastUpdatedAt;
    wmId = lastId;
    await db
      .update(migrationReverseSync)
      .set({
        wmUpdatedAt,
        wmId,
        upsertsCount: sql`${migrationReverseSync.upsertsCount} + ${upserts}`,
        deletesCount: sql`${migrationReverseSync.deletesCount} + ${deletes}`,
        lastSyncedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(migrationReverseSync.id, t.id));

    if (rows.length < BATCH) break;
  }

  await db
    .update(migrationReverseSync)
    .set({ status: "idle", updatedAt: new Date() })
    .where(eq(migrationReverseSync.id, t.id));
  return { upserts, deletes };
}

/* ─── Đăng ký replica cho 1 module (chỉ entity đã live) ─── */
export async function enableReplicaForCompany(opts: {
  companyId: string;
  userId: string;
  connectionId: string;
  module: string;
  tables: Array<{
    entityId: string;
    mssqlTable: string;
    pkField: string;
    deleteMode?: "hard" | "soft";
    softDeleteCol?: string | null;
    identityInsert?: boolean;
    lagSeconds?: number;
  }>;
  cronExpr?: string;
}): Promise<{ enabled: number }> {
  const { companyId, userId, connectionId, module } = opts;
  // Upsert module config.
  await db
    .insert(migrationReverseModules)
    .values({ companyId, connectionId, module, enabled: false, createdBy: userId })
    .onConflictDoNothing();
  if (opts.cronExpr) {
    await db
      .update(migrationReverseModules)
      .set({ cronExpr: opts.cronExpr, updatedAt: new Date() })
      .where(
        and(
          eq(migrationReverseModules.companyId, companyId),
          eq(migrationReverseModules.connectionId, connectionId),
          eq(migrationReverseModules.module, module),
        ),
      );
  }

  let enabled = 0;
  for (const t of opts.tables) {
    const ctx = await loadEntityCtx(t.entityId, companyId);
    if (!ctx) throw new Error(`enableReplica: entity ${t.entityId} không phải bảng thật`);
    if (ctx.syncState !== "live") {
      throw new Error(
        `enableReplica: entity ${t.entityId} chưa cutover (state=${ctx.syncState}) — cutover trước khi bật replica`,
      );
    }
    // Tạo index keyset (idempotent).
    const tbl = assertIdent(ctx.storage.tableName);
    await db.execute(
      sql.raw(
        `CREATE INDEX IF NOT EXISTS "${tbl}_revsync_keyset_idx" ON "${tbl}" (company_id, updated_at, id)`,
      ),
    );
    // Bật cờ replica trên entity (merge jsonb — chỉ đặt replicaToMssql,
    // KHÔNG ghi đè sync.state hoặc các key sync khác đã có).
    await db
      .update(entities)
      .set({
        meta: sql`coalesce(${entities.meta}, '{}'::jsonb) || jsonb_build_object('sync', coalesce(${entities.meta}->'sync', '{}'::jsonb) || '{"replicaToMssql":true}'::jsonb)`,
        updatedAt: new Date(),
      })
      .where(eq(entities.id, t.entityId));
    // Upsert reverse_sync row.
    await db
      .insert(migrationReverseSync)
      .values({
        companyId,
        connectionId,
        module,
        entityId: t.entityId,
        mssqlTable: t.mssqlTable,
        pkField: t.pkField,
        deleteMode: t.deleteMode ?? "hard",
        softDeleteCol: t.softDeleteCol ?? null,
        identityInsert: t.identityInsert ?? true,
        lagSeconds: t.lagSeconds ?? 5,
        enabled: true,
        createdBy: userId,
      })
      .onConflictDoUpdate({
        target: [
          migrationReverseSync.companyId,
          migrationReverseSync.connectionId,
          migrationReverseSync.mssqlTable,
        ],
        set: {
          entityId: t.entityId,
          pkField: t.pkField,
          deleteMode: t.deleteMode ?? "hard",
          softDeleteCol: t.softDeleteCol ?? null,
          identityInsert: t.identityInsert ?? true,
          lagSeconds: t.lagSeconds ?? 5,
          enabled: true,
          updatedAt: new Date(),
        },
      });
    enabled++;
  }
  return { enabled };
}

/* ─── Seed: backfill toàn bộ active rows + set watermark t0 ─── */
export async function seedReverseTable(opts: {
  companyId: string;
  reverseSyncId: string;
}): Promise<{ pushed: number }> {
  const [t] = await db
    .select()
    .from(migrationReverseSync)
    .where(
      and(
        eq(migrationReverseSync.id, opts.reverseSyncId),
        eq(migrationReverseSync.companyId, opts.companyId),
      ),
    )
    .limit(1);
  if (!t) throw new Error("seedReverseTable: reverse-sync row không tồn tại");
  await db
    .update(migrationReverseSync)
    .set({ status: "seeding", wmUpdatedAt: null, wmId: null, updatedAt: new Date() })
    .where(eq(migrationReverseSync.id, t.id));
  const client = await loadConn(opts.companyId, t.connectionId);
  let pushed = 0;
  try {
    const stats = await syncOneTable(client, opts.companyId, {
      ...t,
      wmUpdatedAt: null,
      wmId: null,
    });
    pushed = stats.upserts;
  } finally {
    await client.close().catch(() => {});
  }
  return { pushed };
}
