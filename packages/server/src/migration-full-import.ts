/* ==========================================================
   migration-full-import.ts — Phase U: full data import qua queue
   + auto-resume + sync.

   1 job = N table (do user chọn ở QuickMigratePanel). Mỗi table:
   - Detect PK column từ MSSQL info (single col).
   - Loop streamReadByPk theo batchSize cho đến hết.
   - Update lastPk + rowsImported sau mỗi batch (atomic UPDATE).
   - Catch network error → set status='paused' + error.
     Boot scan resume jobs status='running' → re-enqueue (worker tự re-pickup
     từ lastPk hiện tại — không mất data).

   Sync mode (kind='sync'): rerun job với cùng config nhưng giữ lastPk hiện
   tại — chỉ lấy data mới (pk > lastPk).
   ========================================================== */

import { and, eq, inArray, sql } from "drizzle-orm";
import {
  entities,
  entityRecords,
  migrationFullJobs,
  migrationFullJobTables,
  mssqlConnections,
} from "@erp-framework/db";
import { MssqlClient } from "@erp-framework/mssql-client";
import { db } from "./db";
import { decryptSecret } from "./crypto";
import { publish as publishWs } from "./ws-hub";

/* ─── Types ─── */

export interface FullJobItem {
  tableName: string;
  entityName: string;
  label: string;
  fields: Array<{ name: string; label: string; type: string }>;
}

export interface FullJobConfig {
  items: FullJobItem[];
  batchSize?: number;
  writeManifest?: boolean;
}

export interface FullJobData {
  jobId: string;
  userId: string;
}

/* ─── Pre-flight helper: prep tables (run khi tạo job lần đầu) ─── */

/** Chuẩn bị migration_full_job_tables records cho 1 job mới. Detect PK
 *  từ MSSQL info, tạo entity nếu chưa có, insert vào job_tables. */
export async function prepareFullJobTables(
  jobId: string,
  companyId: string,
  userId: string,
  connectionId: string,
  items: FullJobItem[],
  batchSize: number,
): Promise<void> {
  const client = await loadConn(companyId, connectionId);
  try {
    for (const it of items) {
      const [schema, name] = it.tableName.includes(".")
        ? it.tableName.split(".")
        : ["dbo", it.tableName];
      const info = await client.getTable(schema ?? "dbo", name ?? it.tableName);
      const pkColumn = info?.primaryKey?.[0] ?? null;

      // Resolve/tạo entity với guard meta.source.kind=migration.
      let entityId: string | null = null;
      const [existing] = await db
        .select({ id: entities.id, meta: entities.meta })
        .from(entities)
        .where(and(eq(entities.companyId, companyId), eq(entities.name, it.entityName)))
        .limit(1);
      if (existing) {
        const srcKind = (existing.meta as { source?: { kind?: string } } | null)?.source?.kind;
        if (srcKind && srcKind !== "migration") {
          // Manual entity — không đè, record table với error.
          await db.insert(migrationFullJobTables).values({
            jobId,
            tableName: it.tableName,
            entityName: it.entityName,
            pkColumn,
            batchSize,
            status: "failed",
            error: `Entity "${it.entityName}" đã có do user tạo tay (kind=${srcKind}) — skip.`,
          });
          continue;
        }
        entityId = existing.id;
      } else {
        const moduleName = `_quick-${connectionId}`;
        const [inserted] = await db
          .insert(entities)
          .values({
            companyId,
            name: it.entityName,
            label: it.label,
            fields: it.fields,
            meta: {
              source: {
                kind: "migration",
                connectionId,
                module: moduleName,
                mssqlTable: it.tableName,
                importedAt: new Date().toISOString(),
                importedBy: userId,
                rowsLastImported: 0,
              },
            },
          })
          .returning({ id: entities.id });
        if (inserted) entityId = inserted.id;
      }

      await db.insert(migrationFullJobTables).values({
        jobId,
        tableName: it.tableName,
        entityId,
        entityName: it.entityName,
        pkColumn,
        batchSize,
        // "skipped" = lỗi VĨNH VIỄN (không có PK đơn cột) → không retry khi
        // resume, KHÔNG chặn job hoàn thành. Khác "failed" (lỗi tạm — retry được).
        status: pkColumn ? "pending" : "skipped",
        error: pkColumn
          ? null
          : "Không tìm thấy primary key — full stream cần single-column PK. Dùng Quick migrate thường (limit) thay vì Full.",
      });
    }

    // Cập nhật total_tables.
    await db
      .update(migrationFullJobs)
      .set({ totalTables: items.length, updatedAt: new Date() })
      .where(eq(migrationFullJobs.id, jobId));
  } finally {
    await client.close().catch(() => undefined);
  }
}

/* ─── Worker chính ─── */

/** Handler cho action="full-import" trong migration-worker. Chạy stream
 *  từng table → batch insert. Resume tự khi job được re-enqueue (đọc
 *  lastPk hiện tại từ DB). */
export async function runFullImportJob(data: FullJobData): Promise<{
  succeededTables: number;
  failedTables: number;
  skippedTables: number;
  totalRows: number;
}> {
  const [job] = await db
    .select()
    .from(migrationFullJobs)
    .where(eq(migrationFullJobs.id, data.jobId))
    .limit(1);
  if (!job) throw new Error(`Job ${data.jobId} không tồn tại.`);
  if (job.status === "canceled" || job.status === "completed") {
    return { succeededTables: 0, failedTables: 0, skippedTables: 0, totalRows: 0 };
  }

  // Đánh dấu running + startedAt nếu chưa có.
  await db
    .update(migrationFullJobs)
    .set({
      status: "running",
      startedAt: job.startedAt ?? new Date(),
      lastHeartbeat: new Date(),
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(migrationFullJobs.id, data.jobId));

  const client = await loadConn(job.companyId, job.connectionId);
  let succeededTables = 0;
  let failedTables = 0;
  let skippedTables = 0;
  let totalRowsThisRun = 0;

  try {
    // Resume: lấy table còn cần xử lý — pending/running (dở dang) + failed (lỗi
    // TẠM, retry từ lastPk đã lưu). Loại 'done' (xong) và 'skipped' (lỗi vĩnh
    // viễn no-PK — retry vô ích). Trước đây loại luôn 'failed' khiến bảng lỗi
    // mạng giữa chừng KẸT mãi, không bao giờ resume được.
    const tables = await db
      .select()
      .from(migrationFullJobTables)
      .where(
        and(
          eq(migrationFullJobTables.jobId, data.jobId),
          sql`${migrationFullJobTables.status} IN ('pending', 'running', 'failed')`,
        ),
      );

    for (const t of tables) {
      if (!t.pkColumn || !t.entityId) {
        // Thiếu PK/entity → lỗi vĩnh viễn: mark skipped (không retry, không
        // chặn job hoàn thành) thay vì failed.
        await db
          .update(migrationFullJobTables)
          .set({
            status: "skipped",
            error: t.error ?? "Thiếu pkColumn hoặc entityId.",
            updatedAt: new Date(),
          })
          .where(eq(migrationFullJobTables.id, t.id));
        skippedTables++;
        continue;
      }

      await db
        .update(migrationFullJobTables)
        .set({ status: "running", updatedAt: new Date() })
        .where(eq(migrationFullJobTables.id, t.id));

      const fieldsSet = new Set<string>();
      // Đọc entity fields hiện tại để filter row data.
      const [ent] = await db
        .select({ fields: entities.fields })
        .from(entities)
        .where(eq(entities.id, t.entityId))
        .limit(1);
      const entFields = (ent?.fields as Array<{ name: string }>) ?? [];
      for (const f of entFields) fieldsSet.add(f.name.toLowerCase());

      try {
        let lastPk: string | null = t.lastPk;
        let rowsImported = t.rowsImported;
        const tableEntityId = t.entityId;
        while (true) {
          const batch = await client.streamReadByPk<Record<string, unknown>>({
            schemaTable: t.tableName,
            pkColumn: t.pkColumn,
            lastPk,
            batchSize: t.batchSize,
          });
          if (batch.rows.length > 0) {
            // Map row → entity_records.data filter theo fields.
            const mapped: Array<Record<string, unknown>> = batch.rows.map(
              (r: Record<string, unknown>) => {
                const dataObj: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(r)) {
                  const key = k.toLowerCase();
                  if (fieldsSet.size === 0 || fieldsSet.has(key)) {
                    dataObj[key] = v;
                  }
                }
                return dataObj;
              },
            );

            // UPSERT theo PK chống duplicate khi user tạo job lại (vd cancel
            // rồi start cùng bảng). Detect pkField = pkColumn lower-case.
            const pkField = t.pkColumn.toLowerCase();
            const pkValues: string[] = [];
            for (const d of mapped) {
              const v = d[pkField];
              if (v != null) pkValues.push(String(v));
            }
            const existingRows =
              pkValues.length > 0
                ? await db
                    .select({ id: entityRecords.id, data: entityRecords.data })
                    .from(entityRecords)
                    .where(
                      and(
                        eq(entityRecords.companyId, job.companyId),
                        eq(entityRecords.entityId, tableEntityId),
                        inArray(sql`(${entityRecords.data}->>${pkField})`, pkValues),
                      ),
                    )
                : [];
            const existingMap = new Map<string, string>(); // pkValue → record.id
            for (const r of existingRows) {
              const pkVal = (r.data as Record<string, unknown>)[pkField];
              if (pkVal != null) existingMap.set(String(pkVal), r.id);
            }

            const toInsert: Array<Record<string, unknown>> = [];
            const toUpdate: Array<{ id: string; data: Record<string, unknown> }> = [];
            for (const d of mapped) {
              const pkVal = d[pkField];
              if (pkVal == null) {
                toInsert.push(d);
                continue;
              }
              const existingId = existingMap.get(String(pkVal));
              if (existingId) toUpdate.push({ id: existingId, data: d });
              else toInsert.push(d);
            }

            const prevPk = lastPk;
            const nextPk = batch.nextLastPk;

            // Chống loop vô hạn: có rows nhưng PK KHÔNG tiến (null hoặc không
            // đổi). streamReadByPk với lastPk=null sẽ bỏ WHERE → đọc LẠI từ đầu
            // bảng; nếu batch đầy (isEnd=false) thì lặp mãi. Abort TRƯỚC khi ghi
            // (batch này không checkpoint được, resume sẽ đọc lại từ prevPk).
            if (!batch.isEnd && (nextPk == null || nextPk === prevPk)) {
              throw new Error(
                `PK "${t.pkColumn}" không tiến (giá trị cuối: ${nextPk ?? "null"}) — ` +
                  `không stream tiếp an toàn được. Bảng cần single-column PK tăng dần, không null.`,
              );
            }

            rowsImported += batch.rows.length;
            lastPk = nextPk;
            const checkpointRows = rowsImported;
            const checkpointPk = lastPk;

            // ATOMIC: data-write (insert + update) + checkpoint (lastPk +
            // rowsImported) trong 1 transaction. Crash giữa chừng KHÔNG để
            // checkpoint lệch với data đã ghi → resume không over-count.
            await db.transaction(async (tx) => {
              if (toInsert.length > 0) {
                await tx.insert(entityRecords).values(
                  toInsert.map((d) => ({
                    companyId: job.companyId,
                    entityId: tableEntityId,
                    data: d,
                    createdBy: data.userId,
                  })),
                );
              }
              for (const u of toUpdate) {
                await tx
                  .update(entityRecords)
                  .set({ data: u.data, updatedAt: new Date() })
                  .where(eq(entityRecords.id, u.id));
              }
              await tx
                .update(migrationFullJobTables)
                .set({
                  lastPk: checkpointPk,
                  rowsImported: checkpointRows,
                  updatedAt: new Date(),
                })
                .where(eq(migrationFullJobTables.id, t.id));
            });

            // Heartbeat job (ngoài tx — chỉ là liveness, không cần atomic).
            await db
              .update(migrationFullJobs)
              .set({ lastHeartbeat: new Date(), updatedAt: new Date() })
              .where(eq(migrationFullJobs.id, data.jobId));

            // Publish WS progress.
            publishWs(`migration:${data.userId}`, {
              kind: "full-progress",
              jobId: data.jobId,
              tableId: t.id,
              tableName: t.tableName,
              rowsImported,
              lastPk,
            });
            totalRowsThisRun += batch.rows.length;
          }
          if (batch.isEnd) break;
        }

        // Cập nhật meta.source.importedAt + rowsLastImported.
        await db
          .update(entities)
          .set({
            meta: {
              source: {
                kind: "migration",
                connectionId: job.connectionId,
                module: `_quick-${job.connectionId}`,
                mssqlTable: t.tableName,
                importedAt: new Date().toISOString(),
                importedBy: data.userId,
                rowsLastImported: rowsImported,
              },
            },
            updatedAt: new Date(),
          })
          .where(eq(entities.id, tableEntityId));

        // Reconciliation: so COUNT nguồn (MSSQL) vs đích (entity_records). Drift
        // = mất/thừa dữ liệu âm thầm — đánh dấu để completion coi như CHƯA xong.
        let reconcile: "ok" | "drift" | "skip" = "skip";
        let srcCount: number | null = null;
        let tgtCount: number | null = null;
        try {
          srcCount = await client.countRows(t.tableName);
          const [c] = await db
            .select({ n: sql<number>`count(*)::bigint` })
            .from(entityRecords)
            .where(
              and(
                eq(entityRecords.companyId, job.companyId),
                eq(entityRecords.entityId, tableEntityId),
              ),
            );
          tgtCount = Number(c?.n ?? 0);
          reconcile = srcCount === tgtCount ? "ok" : "drift";
        } catch {
          // Không đếm được nguồn (vd view, quyền) → skip, không chặn.
          reconcile = "skip";
        }

        await db
          .update(migrationFullJobTables)
          .set({ status: "done", srcCount, tgtCount, reconcile, updatedAt: new Date() })
          .where(eq(migrationFullJobTables.id, t.id));
        succeededTables++;
      } catch (e) {
        // Lỗi mạng / MSSQL — set table failed nhưng KHÔNG cancel job.
        // Boot resume sẽ pickup lại nếu user trigger resume.
        await db
          .update(migrationFullJobTables)
          .set({
            status: "failed",
            error: (e as Error).message,
            updatedAt: new Date(),
          })
          .where(eq(migrationFullJobTables.id, t.id));
        failedTables++;
      }
    }

    // Đếm lại trạng thái cuối loop. Phân biệt:
    //  - done    : import xong
    //  - skipped : lỗi vĩnh viễn (no-PK) — KHÔNG chặn hoàn thành
    //  - failed  : lỗi tạm — còn retry được (resume sẽ pickup)
    //  - pending : còn dở (vd vượt giới hạn run, chưa tới lượt)
    const [stats] = await db
      .select({
        completed: sql<number>`count(*) FILTER (WHERE status = 'done')::int`,
        skipped: sql<number>`count(*) FILTER (WHERE status = 'skipped')::int`,
        failed: sql<number>`count(*) FILTER (WHERE status = 'failed')::int`,
        pending: sql<number>`count(*) FILTER (WHERE status IN ('pending', 'running'))::int`,
        // Bảng đã 'done' nhưng reconcile lệch nguồn≠đích — coi như CHƯA xong.
        drift: sql<number>`count(*) FILTER (WHERE status = 'done' AND reconcile = 'drift')::int`,
        totalRows: sql<number>`COALESCE(sum(rows_imported), 0)::bigint`,
      })
      .from(migrationFullJobTables)
      .where(eq(migrationFullJobTables.jobId, data.jobId));

    const totalRowsAll = Number(stats?.totalRows ?? 0);
    // Còn việc cần làm = failed (retry được) + pending/running + drift (đếm
    // lệch → cần re-import/điều tra). skipped & done-ok coi như đã giải quyết.
    const unresolved = (stats?.failed ?? 0) + (stats?.pending ?? 0) + (stats?.drift ?? 0);
    const allDone = unresolved === 0;
    // Còn việc nhưng đã có tiến triển → paused để user/boot resume. Chưa làm
    // được gì (toàn lỗi) → failed.
    const hasProgress = (stats?.completed ?? 0) > 0 || (stats?.skipped ?? 0) > 0;
    const finalStatus = allDone ? "completed" : hasProgress ? "paused" : "failed";

    await db
      .update(migrationFullJobs)
      .set({
        status: finalStatus,
        completedTables: stats?.completed ?? 0,
        totalRowsImported: totalRowsAll,
        completedAt: allDone ? new Date() : null,
        lastHeartbeat: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(migrationFullJobs.id, data.jobId));

    publishWs(`migration:${data.userId}`, {
      kind: "full-job-done",
      jobId: data.jobId,
      status: finalStatus,
      completedTables: stats?.completed ?? 0,
      skippedTables: stats?.skipped ?? 0,
      failedTables: stats?.failed ?? 0,
      totalRows: totalRowsAll,
    });
  } catch (e) {
    // Job-level error (vd MSSQL connection failure).
    await db
      .update(migrationFullJobs)
      .set({
        status: "paused", // paused để user retry/resume
        error: (e as Error).message,
        lastHeartbeat: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(migrationFullJobs.id, data.jobId));
    throw e;
  } finally {
    await client.close().catch(() => undefined);
  }

  return { succeededTables, failedTables, skippedTables, totalRows: totalRowsThisRun };
}

/* ─── Resume on boot ─── */

/** Khi server boot, scan jobs kẹt 'running'/'queued' (server crash giữa chừng)
 *  → re-enqueue. KHÔNG tự resume 'paused' — paused là trạng thái user chủ động
 *  dừng hoặc partial-fail cần user quyết định; auto-resume mỗi lần boot sẽ chạy
 *  import ngoài ý muốn. User resume thủ công qua endpoint resumeFullJob. */
export async function resumeStaleFullJobs(
  enqueue: (jobId: string, userId: string) => Promise<void>,
): Promise<{ count: number; jobIds: string[] }> {
  const stale = await db
    .select({ id: migrationFullJobs.id, createdBy: migrationFullJobs.createdBy })
    .from(migrationFullJobs)
    .where(sql`${migrationFullJobs.status} IN ('running', 'queued')`);
  for (const s of stale) {
    if (!s.createdBy) continue;
    await enqueue(s.id, s.createdBy);
  }
  console.log(`[migration-full-import] Resume ${stale.length} stale job(s) khi boot.`);
  return { count: stale.length, jobIds: stale.map((s) => s.id) };
}

/* ─── Helper ─── */

async function loadConn(companyId: string, connectionId: string): Promise<MssqlClient> {
  const [row] = await db
    .select()
    .from(mssqlConnections)
    .where(and(eq(mssqlConnections.companyId, companyId), eq(mssqlConnections.id, connectionId)))
    .limit(1);
  if (!row) throw new Error(`Connection MSSQL ${connectionId} không tồn tại.`);
  const client = MssqlClient.fromConfig({
    host: row.host,
    port: row.port,
    database: row.database,
    username: row.username,
    password: decryptSecret(row.passwordEnc),
    encrypt: row.encrypt,
    trustServerCert: row.trustServerCert,
    allowWrite: row.allowWrite,
    requestTimeoutMs: 120_000, // full import có thể chạy lâu — tăng timeout per request
  });
  await client.connect();
  return client;
}
