/* ==========================================================
   migration-delta-sync.ts — Delta-sync worker: đồng bộ liên tục
   MSSQL -> PG qua Change Tracking (CT) hoặc rescan fallback.

   Kiến trúc:
   - runDeltaSyncRun({companyId, connectionId, module}): 1 chu kỳ sync.
     Gọi từ migration-worker.ts action='delta-sync' (pg-boss).
   - seedSyncTable(id): baseline 1 bảng trước khi bật CT polling.
     Gọi từ migration-sync-router.ts enableModuleSync.

   Nguyên tắc:
   - CT mode: CHANGETABLE bắt I/U/D, advance ct_last_version ATOMIC
     cùng transaction ghi data (bài học #13).
   - Rescan mode: stream upsert toàn bảng + detect delete qua so PK.
   - DELETE => soft-delete (deleted_at=now()). Re-insert cùng PK =>
     clear deleted_at=NULL trong cùng upsert.
   - Heartbeat lock chống chồng lấn (UPDATE...RETURNING); stale 10 phút.
   - Tái dùng findExistingInTable/insertRowToTable/updateRowInTable từ
     migration-full-import.ts (đã export).
   ========================================================== */

import {
  entities,
  entityRecords,
  migrationSyncModules,
  migrationSyncRuns,
  migrationSyncTables,
  recordLocator,
} from "@erp-framework/db";
import type { MssqlClient } from "@erp-framework/mssql-client";
import { and, eq, inArray, isNull, lt, not, or, sql } from "drizzle-orm";
import { db } from "./db";
import type { EntityStorage } from "./entity-table-ddl";
import {
  findExistingInTable,
  insertRowToTable,
  loadConn,
  type SqlExecutor,
  updateRowInTable,
} from "./migration-full-import";
import { findMigratedEntityBySourceTable } from "./migration-migrated-set";
import { publish as publishWs } from "./ws-hub";

/* ─── Types ─── */

export interface DeltaSyncResult {
  inserts: number;
  updates: number;
  deletes: number;
  tablesRun: number;
  skipped?: boolean;
  error?: string;
}

interface TableSyncStats {
  inserts: number;
  updates: number;
  deletes: number;
  status?: string;
}

type SyncTableRow = typeof migrationSyncTables.$inferSelect;

/** Watermark CT an toàn sau 1 batch keyset (version, pk).
 *  - Batch hết (isEnd): cả nhóm version cuối đã trọn → persist max version.
 *  - Batch bị TOP cắt: nhóm version cuối CÓ THỂ còn dở → chỉ persist tới
 *    maxVersion - 1 (mọi version < max chắc chắn trọn vì đã ORDER).
 *  - Không bao giờ lùi dưới watermark đã persist (nhóm khổng lồ > batchSize
 *    nhiều vòng liền giữ nguyên watermark, cursor in-memory vẫn tiến).
 *  Pure function — unit test trực tiếp. */
export function ctSafeWatermark(
  persistedVersion: number,
  batchMaxVersion: number,
  isEnd: boolean,
): number {
  return Math.max(persistedVersion, isEnd ? batchMaxVersion : batchMaxVersion - 1);
}

/* ─── Heartbeat lock helpers ─── */

/** Claim heartbeat lock cho module. Trả token (giá trị heartbeatAt đã set)
 *  nếu thành công, null nếu lock đang bị giữ. Stale threshold 10 phút
 *  (crash recovery). Token dùng để refresh/release CÓ ĐIỀU KIỆN — run dài
 *  bị steal lock (stale) phải tự phát hiện và abort, không đè lock mới. */
async function claimHeartbeat(moduleId: string): Promise<Date | null> {
  const staleThreshold = new Date(Date.now() - 10 * 60 * 1000);
  const token = new Date();
  const claimed = await db
    .update(migrationSyncModules)
    .set({ heartbeatAt: token, updatedAt: token })
    .where(
      and(
        eq(migrationSyncModules.id, moduleId),
        or(
          isNull(migrationSyncModules.heartbeatAt),
          lt(migrationSyncModules.heartbeatAt, staleThreshold),
        ),
      ),
    )
    .returning({ id: migrationSyncModules.id });
  return claimed.length > 0 ? token : null;
}

/** Refresh heartbeat giữa run dài (gọi sau mỗi bảng). Trả token mới, hoặc
 *  null nếu lock đã bị run khác claim (mình stale quá 10 phút) → caller
 *  PHẢI abort, không tiếp tục ghi. */
async function refreshHeartbeat(moduleId: string, token: Date): Promise<Date | null> {
  const next = new Date();
  const r = await db
    .update(migrationSyncModules)
    .set({ heartbeatAt: next, updatedAt: next })
    .where(and(eq(migrationSyncModules.id, moduleId), eq(migrationSyncModules.heartbeatAt, token)))
    .returning({ id: migrationSyncModules.id });
  return r.length > 0 ? next : null;
}

/** Release lock CHỈ khi mình còn giữ (token khớp) — tránh xoá lock của
 *  run khác đã steal sau khi mình stale. */
async function releaseHeartbeat(moduleId: string, token: Date): Promise<void> {
  await db
    .update(migrationSyncModules)
    .set({ heartbeatAt: null, updatedAt: new Date() })
    .where(and(eq(migrationSyncModules.id, moduleId), eq(migrationSyncModules.heartbeatAt, token)));
}

/* ─── EAV upsert helpers (tái dùng pattern full-import) ─── */

async function findExistingEav(
  companyId: string,
  entityId: string,
  pkField: string,
  pkValues: string[],
): Promise<Map<string, { id: string; deletedAt: Date | null }>> {
  const map = new Map<string, { id: string; deletedAt: Date | null }>();
  if (pkValues.length === 0) return map;
  const rows = await db
    .select({ id: entityRecords.id, data: entityRecords.data, deletedAt: entityRecords.deletedAt })
    .from(entityRecords)
    .where(
      and(
        eq(entityRecords.companyId, companyId),
        eq(entityRecords.entityId, entityId),
        inArray(sql`(${entityRecords.data}->>${pkField})`, pkValues),
      ),
    );
  for (const r of rows) {
    const pkVal = (r.data as Record<string, unknown>)[pkField];
    if (pkVal != null) map.set(String(pkVal), { id: r.id, deletedAt: r.deletedAt ?? null });
  }
  return map;
}

/** Soft-delete 1 record trong bảng thật theo PK value. */
async function softDeleteTableRow(
  tx: SqlExecutor,
  storage: EntityStorage,
  companyId: string,
  pkField: string,
  pkValue: string,
): Promise<boolean> {
  const tbl = sql.raw(`"${storage.tableName}"`);
  const colMap = storage.columns[pkField];
  const pkExpr = colMap ? sql.raw(`"${colMap.col}"::text`) : sql`ext->>${pkField}`;
  const res = await tx.execute(
    sql`UPDATE ${tbl} SET deleted_at = now(), updated_at = now()
        WHERE company_id = ${companyId}::uuid
          AND ${pkExpr} = ${pkValue}
          AND deleted_at IS NULL
        RETURNING id`,
  );
  const list = Array.isArray(res)
    ? (res as Array<{ id?: string }>)
    : ((res as { rows?: Array<{ id?: string }> }).rows ?? []);
  return list.length > 0;
}

/** Clear deleted_at = NULL (restore) cho row table bằng id. */
async function clearDeletedAt(tx: SqlExecutor, storage: EntityStorage, id: string): Promise<void> {
  const tbl = sql.raw(`"${storage.tableName}"`);
  await tx.execute(
    sql`UPDATE ${tbl} SET deleted_at = NULL, updated_at = now() WHERE id = ${id}::uuid`,
  );
}

/* ─── Sync 1 bảng theo mode ─── */

async function syncTableCt(
  t: SyncTableRow,
  client: MssqlClient,
  userId: string,
): Promise<TableSyncStats> {
  if (!t.pkColumn) return { inserts: 0, updates: 0, deletes: 0, status: "no_pk" };
  if (!t.entityId) return { inserts: 0, updates: 0, deletes: 0, status: "no_entity" };

  // Load entity meta + storage.
  const [ent] = await db
    .select({ fields: entities.fields, meta: entities.meta })
    .from(entities)
    .where(and(eq(entities.id, t.entityId), eq(entities.companyId, t.companyId)));
  if (!ent) return { inserts: 0, updates: 0, deletes: 0, status: "no_entity" };
  const storage = (ent.meta as { storage?: EntityStorage } | null)?.storage;
  const useTable = storage?.tier === "table";

  // Seed BẮT BUỘC: chưa có watermark (null) mà poll CHANGETABLE(CHANGES, 0)
  // sẽ mất rows tồn tại TRƯỚC khi bật CT + khoảng hở full-import→bật-CT.
  // (runDeltaSyncRun route nhánh này sang auto-seed — guard phòng gọi thẳng.)
  if (t.ctLastVersion == null) {
    await db
      .update(migrationSyncTables)
      .set({
        status: "reseed_required",
        lastError: "Chua seed (ct_last_version null) — can seed truoc khi poll CT.",
        updatedAt: new Date(),
      })
      .where(eq(migrationSyncTables.id, t.id));
    return { inserts: 0, updates: 0, deletes: 0, status: "reseed_required" };
  }

  // Check retention: nếu watermark đã hết hạn phải reseed.
  const lastVersion = t.ctLastVersion ?? 0;
  if (lastVersion > 0) {
    const minValid = await client.getCtMinValidVersion(t.tableName);
    if (minValid !== null && lastVersion < minValid) {
      await db
        .update(migrationSyncTables)
        .set({
          status: "reseed_required",
          lastError: `CT watermark ${lastVersion} < min valid ${minValid}`,
          updatedAt: new Date(),
        })
        .where(eq(migrationSyncTables.id, t.id));
      return { inserts: 0, updates: 0, deletes: 0, status: "reseed_required" };
    }
  }

  await db
    .update(migrationSyncTables)
    .set({ status: "running", updatedAt: new Date() })
    .where(eq(migrationSyncTables.id, t.id));

  let inserts = 0;
  let updates = 0;
  let deletes = 0;
  // Keyset cursor (version, pk): mọi row đổi trong CÙNG 1 transaction MSSQL
  // mang CÙNG SYS_CHANGE_VERSION — phân trang chỉ theo version sẽ MẤT phần
  // nhóm version bị TOP cắt. Anchor giữ nguyên = watermark đã persist;
  // cursor tiến trong-run; watermark chỉ persist tới version ĐÃ TRỌN NHÓM.
  const anchorVersion = lastVersion;
  let persistedVersion = lastVersion;
  let cursorVersion = lastVersion;
  let cursorPk: unknown = null;

  while (true) {
    const batch = await client.readCtChanges({
      schemaTable: t.tableName,
      pkColumn: t.pkColumn,
      lastVersion: anchorVersion,
      cursorVersion,
      cursorPk,
      batchSize: 500,
    });

    if (batch.rows.length === 0) {
      // Batch rỗng = nhóm version tại cursor đã TRỌN (batch trước vừa đúng
      // TOP nên isEnd=false). Persist nốt watermark = cursorVersion — nếu
      // không, watermark kẹt ở max-1: chu kỳ sau re-đọc nhóm cuối mãi và
      // pending_changes >= 1 vĩnh viễn (chặn cutover).
      if (cursorVersion > persistedVersion) {
        await db
          .update(migrationSyncTables)
          .set({ ctLastVersion: cursorVersion, updatedAt: new Date() })
          .where(eq(migrationSyncTables.id, t.id));
        persistedVersion = cursorVersion;
      }
      break;
    }

    const pkLower = t.pkColumn.toLowerCase();
    const toUpsert = batch.rows.filter((r) => r._ct_operation !== "D");
    const toDelete = batch.rows.filter((r) => r._ct_operation === "D");
    // Watermark an toàn: batch chưa hết → nhóm version cuối có thể còn dở
    // (TOP cắt giữa nhóm) → chỉ persist tới maxVersion - 1; không bao giờ lùi.
    // Crash giữa nhóm → resume re-đọc cả nhóm, upsert/soft-delete idempotent.
    const batchMaxVersion = batch.nextVersion;
    const newVersion = ctSafeWatermark(persistedVersion, batchMaxVersion, batch.isEnd);

    // Tìm record đã có theo PK để phân biệt insert vs update.
    const upsertPkValues = toUpsert
      .map((r) => {
        const v = (r as Record<string, unknown>)[pkLower];
        return v != null ? String(v) : null;
      })
      .filter((v): v is string => v !== null);

    const deletePkValues = toDelete
      .map((r) => {
        const v = (r as Record<string, unknown>)[pkLower];
        return v != null ? String(v) : null;
      })
      .filter((v): v is string => v !== null);

    let existingTableMap: Map<string, string> = new Map();
    let existingEavMap: Map<string, { id: string; deletedAt: Date | null }> = new Map();

    if (useTable && storage) {
      existingTableMap = await findExistingInTable(storage, t.companyId, pkLower, [
        ...upsertPkValues,
        ...deletePkValues,
      ]);
    } else {
      existingEavMap = await findExistingEav(t.companyId, t.entityId!, pkLower, [
        ...upsertPkValues,
        ...deletePkValues,
      ]);
    }

    let batchInserts = 0;
    let batchUpdates = 0;
    let batchDeletes = 0;

    // ATOMIC: ghi data + advance watermark trong 1 transaction (bài học #13).
    await db.transaction(async (tx) => {
      // Upsert I/U rows.
      for (const row of toUpsert) {
        const rawData = { ...(row as Record<string, unknown>) };
        delete rawData._ct_operation;
        delete rawData._ct_version;
        const pkVal = rawData[pkLower];
        if (pkVal == null) continue;
        const pkStr = String(pkVal);

        if (useTable && storage) {
          const existingId = existingTableMap.get(pkStr);
          if (existingId) {
            // Clear deleted_at nếu row đã soft-delete (re-insert trên MSSQL).
            await clearDeletedAt(tx, storage, existingId);
            await updateRowInTable(tx, storage, existingId, rawData);
            batchUpdates++;
          } else {
            const newId = await insertRowToTable(tx, storage, t.companyId, userId, rawData);
            if (newId) {
              await tx
                .insert(recordLocator)
                .values({ id: newId, companyId: t.companyId, entityId: t.entityId! })
                .onConflictDoNothing();
              batchInserts++;
            }
          }
        } else {
          const existing = existingEavMap.get(pkStr);
          if (existing) {
            await tx
              .update(entityRecords)
              .set({ data: rawData, updatedAt: new Date(), deletedAt: null })
              .where(eq(entityRecords.id, existing.id));
            batchUpdates++;
          } else {
            await tx.insert(entityRecords).values({
              companyId: t.companyId,
              entityId: t.entityId!,
              data: rawData,
              createdBy: userId,
            });
            batchInserts++;
          }
        }
      }

      // Soft-delete D rows.
      for (const pkStr of deletePkValues) {
        if (useTable && storage) {
          const deleted = await softDeleteTableRow(tx, storage, t.companyId, pkLower, pkStr);
          if (deleted) batchDeletes++;
        } else {
          const existing = existingEavMap.get(pkStr);
          if (existing && !existing.deletedAt) {
            await tx
              .update(entityRecords)
              .set({ deletedAt: new Date(), updatedAt: new Date() })
              .where(eq(entityRecords.id, existing.id));
            batchDeletes++;
          }
        }
      }

      // Advance CT watermark ATOMIC (checkpoint cùng tx ghi data).
      await tx
        .update(migrationSyncTables)
        .set({
          ctLastVersion: newVersion,
          insertsCount: sql`${migrationSyncTables.insertsCount} + ${batchInserts}`,
          updatesCount: sql`${migrationSyncTables.updatesCount} + ${batchUpdates}`,
          deletesCount: sql`${migrationSyncTables.deletesCount} + ${batchDeletes}`,
          lastSyncedAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(migrationSyncTables.id, t.id));
    });

    inserts += batchInserts;
    updates += batchUpdates;
    deletes += batchDeletes;
    persistedVersion = newVersion;
    cursorVersion = batchMaxVersion;
    cursorPk = batch.nextCursorPk;
    if (batch.isEnd) break;
  }

  // Cập nhật src_current_version + pending_changes (best-effort).
  try {
    const currentVer = await client.getCtCurrentVersion();
    if (currentVer !== null) {
      const pending = currentVer > persistedVersion ? currentVer - persistedVersion : 0;
      await db
        .update(migrationSyncTables)
        .set({
          srcCurrentVersion: currentVer,
          pendingChanges: pending,
          status: "idle",
          updatedAt: new Date(),
        })
        .where(eq(migrationSyncTables.id, t.id));
    } else {
      await db
        .update(migrationSyncTables)
        .set({ status: "idle", updatedAt: new Date() })
        .where(eq(migrationSyncTables.id, t.id));
    }
  } catch {
    await db
      .update(migrationSyncTables)
      .set({ status: "idle", updatedAt: new Date() })
      .where(eq(migrationSyncTables.id, t.id));
  }

  return { inserts, updates, deletes };
}

/** Rescan toàn bảng: upsert + detect delete (so tập PK).
 *  Dùng làm fallback khi CT không khả dụng hoặc reseed_required. */
async function syncTableRescan(
  t: SyncTableRow,
  client: MssqlClient,
  userId: string,
): Promise<TableSyncStats> {
  if (!t.pkColumn) return { inserts: 0, updates: 0, deletes: 0, status: "no_pk" };
  if (!t.entityId) return { inserts: 0, updates: 0, deletes: 0, status: "no_entity" };

  const [ent] = await db
    .select({ fields: entities.fields, meta: entities.meta })
    .from(entities)
    .where(and(eq(entities.id, t.entityId), eq(entities.companyId, t.companyId)));
  if (!ent) return { inserts: 0, updates: 0, deletes: 0, status: "no_entity" };
  const storage = (ent.meta as { storage?: EntityStorage } | null)?.storage;
  const useTable = storage?.tier === "table";

  await db
    .update(migrationSyncTables)
    .set({ status: "running", updatedAt: new Date() })
    .where(eq(migrationSyncTables.id, t.id));

  let inserts = 0;
  let updates = 0;
  let lastPk: string | null = null;
  let scanComplete = false;
  const sourcePks = new Set<string>();
  const pkLower = t.pkColumn.toLowerCase();

  // Phase 1: stream upsert toàn bảng.
  while (true) {
    // Annotation tường minh — cắt vòng suy luận kiểu lastPk ↔ batch (TS7022).
    const batch: { rows: Record<string, unknown>[]; nextLastPk: string | null; isEnd: boolean } =
      await client.streamReadByPk({
        schemaTable: t.tableName,
        pkColumn: t.pkColumn,
        lastPk,
        batchSize: 500,
      });
    if (batch.rows.length === 0) {
      scanComplete = true;
      break;
    }

    // Annotation tường minh — cắt vòng suy luận kiểu lastPk ↔ batch (TS7022).
    const nextPk: string | null = batch.nextLastPk;
    if (!batch.isEnd && (nextPk == null || nextPk === lastPk)) {
      // PK không tiến mà bảng chưa hết → ABORT (bài học #13a). Tuyệt đối
      // KHÔNG break im lặng: sourcePks dở dang mà chạy delete-detect phía
      // dưới sẽ soft-delete hàng loạt row chưa kịp scan.
      throw new Error(
        `Rescan ${t.tableName}: PK khong tien (lastPk=${String(lastPk)}) — abort de tranh delete-detect sai.`,
      );
    }

    const pkValues = (batch.rows as Array<Record<string, unknown>>)
      .map((r) => {
        const v = r[pkLower];
        return v != null ? String(v) : null;
      })
      .filter((v): v is string => v !== null);
    for (const v of pkValues) sourcePks.add(v);

    let existingTableMap: Map<string, string> = new Map();
    let existingEavMap: Map<string, { id: string; deletedAt: Date | null }> = new Map();
    if (useTable && storage) {
      existingTableMap = await findExistingInTable(storage, t.companyId, pkLower, pkValues);
    } else {
      existingEavMap = await findExistingEav(t.companyId, t.entityId!, pkLower, pkValues);
    }

    let batchInserts = 0;
    let batchUpdates = 0;
    await db.transaction(async (tx) => {
      for (const row of batch.rows as Array<Record<string, unknown>>) {
        const pkVal = row[pkLower];
        if (pkVal == null) continue;
        const pkStr = String(pkVal);
        if (useTable && storage) {
          const existingId = existingTableMap.get(pkStr);
          if (existingId) {
            await clearDeletedAt(tx, storage, existingId);
            await updateRowInTable(tx, storage, existingId, row);
            batchUpdates++;
          } else {
            const newId = await insertRowToTable(tx, storage, t.companyId, userId, row);
            if (newId) {
              await tx
                .insert(recordLocator)
                .values({ id: newId, companyId: t.companyId, entityId: t.entityId! })
                .onConflictDoNothing();
              batchInserts++;
            }
          }
        } else {
          const existing = existingEavMap.get(pkStr);
          if (existing) {
            await tx
              .update(entityRecords)
              .set({ data: row, updatedAt: new Date(), deletedAt: null })
              .where(eq(entityRecords.id, existing.id));
            batchUpdates++;
          } else {
            await tx.insert(entityRecords).values({
              companyId: t.companyId,
              entityId: t.entityId!,
              data: row,
              createdBy: userId,
            });
            batchInserts++;
          }
        }
      }
      // Checkpoint per-BATCH (không per-row — N update/row làm chậm rescan).
      await tx
        .update(migrationSyncTables)
        .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
        .where(eq(migrationSyncTables.id, t.id));
    });

    inserts += batchInserts;
    updates += batchUpdates;
    lastPk = nextPk;
    if (batch.isEnd) {
      scanComplete = true;
      break;
    }
  }

  // Phase 2: detect delete bằng cách so tập PK nguồn vs đích.
  // GUARD: chỉ chạy khi Phase 1 quét TRỌN bảng — sourcePks thiếu sẽ
  // soft-delete sai hàng loạt.
  if (!scanComplete) {
    throw new Error(`Rescan ${t.tableName}: scan chua tron bang — bo qua delete-detect.`);
  }
  let deletes = 0;
  if (useTable && storage) {
    const tbl = sql.raw(`"${storage.tableName}"`);
    const pkField = pkLower;
    const colMap = storage.columns[pkField];
    const pkExpr = colMap ? sql.raw(`"${colMap.col}"::text`) : sql`ext->>${pkField}`;
    // Đọc tất cả PK đang active ở PG.
    const pgPkRows = (await db.execute(
      sql`SELECT ${pkExpr} AS pk FROM ${tbl} WHERE company_id = ${t.companyId}::uuid AND deleted_at IS NULL`,
    )) as unknown as Array<{ pk: string }> | { rows: Array<{ pk: string }> };
    const pgPks = (Array.isArray(pgPkRows) ? pgPkRows : (pgPkRows.rows ?? [])).map((r) =>
      String(r.pk),
    );
    for (const pgPk of pgPks) {
      if (!sourcePks.has(pgPk)) {
        await softDeleteTableRow(db, storage, t.companyId, pkLower, pgPk);
        deletes++;
      }
    }
  } else {
    const pgRows = await db
      .select({ id: entityRecords.id, data: entityRecords.data })
      .from(entityRecords)
      .where(
        and(
          eq(entityRecords.companyId, t.companyId),
          eq(entityRecords.entityId, t.entityId!),
          isNull(entityRecords.deletedAt),
        ),
      );
    for (const r of pgRows) {
      const pkVal = (r.data as Record<string, unknown>)[pkLower];
      if (pkVal != null && !sourcePks.has(String(pkVal))) {
        await db
          .update(entityRecords)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(entityRecords.id, r.id));
        deletes++;
      }
    }
  }

  await db
    .update(migrationSyncTables)
    .set({
      insertsCount: sql`${migrationSyncTables.insertsCount} + ${inserts}`,
      updatesCount: sql`${migrationSyncTables.updatesCount} + ${updates}`,
      deletesCount: sql`${migrationSyncTables.deletesCount} + ${deletes}`,
      lastSyncedAt: new Date(),
      status: "idle",
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(migrationSyncTables.id, t.id));

  return { inserts, updates, deletes };
}

/** Seed 1 bảng với client đã mở: capture baseline CT version TRƯỚC, rescan
 *  hội tụ, rồi set watermark = baseline (changes trong lúc rescan sẽ được
 *  poll lại — idempotent). Dùng cho cả endpoint seed lẫn auto-seed trong run. */
async function seedTableInner(
  t: SyncTableRow,
  client: MssqlClient,
  userId: string,
): Promise<TableSyncStats> {
  await db
    .update(migrationSyncTables)
    .set({ status: "seeding", updatedAt: new Date() })
    .where(eq(migrationSyncTables.id, t.id));

  // Capture baseline version TRƯỚC khi scan để không bỏ sót change.
  const baselineVersion = await client.getCtCurrentVersion();

  // Rescan-full để hội tụ (upsert I/U + delete-detect).
  const stats = await syncTableRescan(t, client, userId);

  // Sau scan: set ct_last_version về baseline (changes >= baseline sẽ được
  // poll lại ở chu kỳ CT sau — upsert idempotent).
  if (baselineVersion !== null && t.mode === "ct") {
    await db
      .update(migrationSyncTables)
      .set({
        ctLastVersion: baselineVersion,
        status: "idle",
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(migrationSyncTables.id, t.id));
  }
  return stats;
}

/* ─── Public API ─── */

/** Seed 1 bảng theo id (endpoint UI): mở connection riêng rồi gọi seedTableInner. */
export async function seedSyncTable(opts: {
  syncTableId: string;
  userId: string;
}): Promise<{ ok: boolean; inserts: number; updates: number }> {
  const [t] = await db
    .select()
    .from(migrationSyncTables)
    .where(eq(migrationSyncTables.id, opts.syncTableId))
    .limit(1);
  if (!t) throw new Error(`Sync table ${opts.syncTableId} không tồn tại.`);

  const client = await loadConn(t.companyId, t.connectionId);
  try {
    const { inserts, updates } = await seedTableInner(t, client, opts.userId);
    return { ok: true, inserts, updates };
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** Đếm row active (deleted_at IS NULL) phía PG cho 1 bảng sync — dùng cho
 *  verify count nguồn-vs-đích trước cutover. Trả null nếu thiếu entity. */
export async function countDestActiveRows(t: {
  companyId: string;
  entityId: string | null;
}): Promise<number | null> {
  if (!t.entityId) return null;
  const [ent] = await db
    .select({ meta: entities.meta })
    .from(entities)
    .where(and(eq(entities.id, t.entityId), eq(entities.companyId, t.companyId)));
  if (!ent) return null;
  const storage = (ent.meta as { storage?: EntityStorage } | null)?.storage;
  if (storage?.tier === "table") {
    const tbl = sql.raw(`"${storage.tableName}"`);
    const res = await db.execute(
      sql`SELECT count(*)::int AS n FROM ${tbl}
          WHERE company_id = ${t.companyId}::uuid AND deleted_at IS NULL`,
    );
    const list = Array.isArray(res)
      ? (res as Array<{ n?: number }>)
      : ((res as { rows?: Array<{ n?: number }> }).rows ?? []);
    return Number(list[0]?.n ?? 0);
  }
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(entityRecords)
    .where(
      and(
        eq(entityRecords.companyId, t.companyId),
        eq(entityRecords.entityId, t.entityId),
        isNull(entityRecords.deletedAt),
      ),
    );
  return Number(row?.n ?? 0);
}

/** Chạy 1 chu kỳ delta-sync cho 1 module.
 *  Gọi từ migration-worker.ts mỗi khi cron tick.
 *  Trả skipped=true nếu không claim được heartbeat lock (job khác đang chạy). */
export async function runDeltaSyncRun(opts: {
  companyId: string;
  connectionId: string;
  module: string;
  userId: string;
}): Promise<DeltaSyncResult> {
  const [mod] = await db
    .select()
    .from(migrationSyncModules)
    .where(
      and(
        eq(migrationSyncModules.companyId, opts.companyId),
        eq(migrationSyncModules.connectionId, opts.connectionId),
        eq(migrationSyncModules.module, opts.module),
      ),
    )
    .limit(1);

  if (!mod?.enabled) {
    return { inserts: 0, updates: 0, deletes: 0, tablesRun: 0 };
  }

  const claimedToken = await claimHeartbeat(mod.id);
  if (!claimedToken) {
    return { inserts: 0, updates: 0, deletes: 0, tablesRun: 0, skipped: true };
  }
  let hbToken: Date | null = claimedToken;

  let totalInserts = 0;
  let totalUpdates = 0;
  let totalDeletes = 0;
  let tablesRun = 0;
  let runError: string | undefined;

  try {
    // Lấy danh sách bảng cần sync (enabled, chưa cutover, không phải manual).
    const tables = await db
      .select()
      .from(migrationSyncTables)
      .where(
        and(
          eq(migrationSyncTables.companyId, opts.companyId),
          eq(migrationSyncTables.connectionId, opts.connectionId),
          eq(migrationSyncTables.module, opts.module),
          eq(migrationSyncTables.enabled, true),
          not(eq(migrationSyncTables.status, "cutover")),
          not(eq(migrationSyncTables.mode, "manual")),
        ),
      );

    if (tables.length === 0) return { inserts: 0, updates: 0, deletes: 0, tablesRun: 0 };

    const client = await loadConn(opts.companyId, opts.connectionId);
    try {
      for (const t of tables) {
        // Refresh heartbeat trước mỗi bảng — run dài quá 10 phút mà không
        // refresh sẽ bị tick sau steal lock → 2 run chồng nhau (nguy hiểm
        // nhất: rescan delete-detect song song CT upsert). Mất lock → abort.
        // Annotation tường minh — cắt vòng suy luận kiểu hbToken ↔ refreshed.
        const refreshed: Date | null = hbToken ? await refreshHeartbeat(mod.id, hbToken) : null;
        if (!refreshed) {
          hbToken = null;
          runError = "Mat heartbeat lock giua run (stale steal) — abort.";
          console.error(`[delta-sync] Module ${opts.module}: ${runError}`);
          break;
        }
        hbToken = refreshed;
        const tableStart = Date.now();
        try {
          let stats: TableSyncStats;
          if (t.mode === "rescan") {
            stats = await syncTableRescan(t, client, opts.userId);
          } else if (t.ctLastVersion == null || t.status === "reseed_required") {
            // Auto-SEED (không phải rescan thuần): rescan thuần KHÔNG reset
            // watermark → chu kỳ sau lại reseed_required → quét nặng mãi.
            // Seed = baseline version + rescan + set ct_last_version.
            stats = await seedTableInner(t, client, opts.userId);
          } else {
            stats = await syncTableCt(t, client, opts.userId);
          }
          totalInserts += stats.inserts;
          totalUpdates += stats.updates;
          totalDeletes += stats.deletes;
          tablesRun++;

          // Ghi run log per-bảng (durationMs đo riêng từng bảng).
          await db.insert(migrationSyncRuns).values({
            companyId: opts.companyId,
            connectionId: opts.connectionId,
            module: opts.module,
            tableName: t.tableName,
            finishedAt: new Date(),
            durationMs: Date.now() - tableStart,
            inserts: stats.inserts,
            updates: stats.updates,
            deletes: stats.deletes,
          });

          publishWs(`migration:${opts.userId}`, {
            kind: "sync-progress",
            module: opts.module,
            tableName: t.tableName,
            inserts: stats.inserts,
            updates: stats.updates,
            deletes: stats.deletes,
          });
        } catch (e) {
          const errMsg = (e as Error).message;
          await db
            .update(migrationSyncTables)
            .set({ status: "error", lastError: errMsg, updatedAt: new Date() })
            .where(eq(migrationSyncTables.id, t.id));
          console.error(`[delta-sync] Lỗi bảng ${t.tableName}:`, errMsg);
        }
      }
    } finally {
      await client.close().catch(() => undefined);
    }
  } catch (e) {
    runError = (e as Error).message;
    console.error(`[delta-sync] Module ${opts.module} lỗi:`, runError);
  } finally {
    // Chỉ release khi còn giữ lock — mất lock (steal) thì lock đã thuộc
    // run khác, xoá bừa sẽ mở cửa cho run thứ 3 chồng tiếp.
    if (hbToken) await releaseHeartbeat(mod.id, hbToken);
  }

  return {
    inserts: totalInserts,
    updates: totalUpdates,
    deletes: totalDeletes,
    tablesRun,
    error: runError,
  };
}

/* ─── Bật sync module (logic chung tRPC enableModuleSync + MCP) ─── */

export interface EnableSyncInput {
  connectionId: string;
  module: string;
  cronExpr?: string;
  tables: Array<{ tableName: string; pkColumn?: string; mode?: "ct" | "rescan" | "manual" }>;
}

/** Upsert module row + per-table rows (idempotent), gắn entity theo
 *  meta.source.mssqlTable, set meta.sync.state='mirror' (merge jsonb).
 *  Dùng chung cho tRPC migrationSync.enableModuleSync và MCP /mcp/migration. */
export async function enableModuleSyncForCompany(
  companyId: string,
  userId: string,
  input: EnableSyncInput,
): Promise<{ modId: string; created: string[]; linked: number; unlinked: string[] }> {
  const cronExpr = input.cronExpr ?? "*/5 * * * *";

  const existingMod = await db
    .select({ id: migrationSyncModules.id })
    .from(migrationSyncModules)
    .where(
      and(
        eq(migrationSyncModules.companyId, companyId),
        eq(migrationSyncModules.connectionId, input.connectionId),
        eq(migrationSyncModules.module, input.module),
      ),
    )
    .limit(1);

  let modId: string;
  if (existingMod[0]) {
    modId = existingMod[0].id;
    await db
      .update(migrationSyncModules)
      .set({ enabled: true, cronExpr, createdBy: userId, updatedAt: new Date() })
      .where(eq(migrationSyncModules.id, modId));
  } else {
    const [ins] = await db
      .insert(migrationSyncModules)
      .values({
        companyId,
        connectionId: input.connectionId,
        module: input.module,
        enabled: true,
        cronExpr,
        createdBy: userId,
      })
      .returning({ id: migrationSyncModules.id });
    if (!ins) throw new Error("Tao sync module that bai.");
    modId = ins.id;
  }

  const created: string[] = [];
  const unlinked: string[] = [];
  let linked = 0;
  for (const tbl of input.tables) {
    const entRow = await findMigratedEntityBySourceTable(db, companyId, tbl.tableName);
    const entityId = entRow?.id ?? null;
    if (entityId) linked += 1;
    else unlinked.push(tbl.tableName);

    const exists = await db
      .select({ id: migrationSyncTables.id })
      .from(migrationSyncTables)
      .where(
        and(
          eq(migrationSyncTables.companyId, companyId),
          eq(migrationSyncTables.connectionId, input.connectionId),
          eq(migrationSyncTables.tableName, tbl.tableName),
        ),
      )
      .limit(1);

    if (!exists[0]) {
      await db.insert(migrationSyncTables).values({
        companyId,
        connectionId: input.connectionId,
        module: input.module,
        tableName: tbl.tableName,
        entityId,
        pkColumn: tbl.pkColumn ?? null,
        mode: tbl.mode ?? "ct",
        enabled: true,
      });
      created.push(tbl.tableName);
    }

    // meta.sync.state='mirror' — merge jsonb (bai hoc #20), KHONG ghi de meta.
    if (entityId) {
      await db
        .update(entities)
        .set({
          meta: sql`coalesce(${entities.meta}, '{}'::jsonb) || '{"sync":{"state":"mirror"}}'::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(entities.id, entityId));
    }
  }

  return { modId, created, linked, unlinked };
}
