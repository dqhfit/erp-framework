/* ==========================================================
   entity-promote.ts — Nâng cấp một entity từ EAV (entity_records) sang
   bảng thật er_<id> (Phase 2). CHỈ chạy khi ERP_HYBRID_TABLES=1.

   Quy trình: ensureEntityTable → copy mọi record (GIỮ NGUYÊN id/version/
   timestamp/deleted_at + ciphertext field encrypted ở ext) → ghi locator →
   verify count → flip entities.meta.storage atomic.

   KHÔNG xoá entity_records cũ: giữ lại làm SNAPSHOT ĐÔNG LẠNH (reads/writes
   sau đó đi vào bảng thật). LƯU Ý (cập nhật sau 0071): các bảng phụ
   (entity_record_versions/embeddings/field_ops/presence/timeseries) đã BỎ FK
   record_id→entity_records ở migration 0071 nên KHÔNG còn cascade khi xoá
   entity_records — chúng trỏ theo id (id này giờ sống ở er_), history vẫn
   nguyên. Vì vậy dọn EAV giờ AN TOÀN về lịch sử; chỉ mất khả năng demote
   từ snapshot cho dòng đã hard-delete khỏi er_ (hiếm). Dọn EAV vẫn là bước
   OPT-IN, thủ công.

   CHƯA verify runtime — cần Postgres e2e.
   ========================================================== */

import type { EntityFieldDef } from "@erp-framework/core";
import { entities, entityRecords, recordLocator } from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { DB } from "./db";
import {
  applyColumnLabels,
  assertIdent,
  type EntityStorage,
  ensureEntityTable,
  renameTableDDL,
  SYSTEM_TABLES,
  safeTableIdent,
  splitDataForStorage,
  tableNameForEntity,
} from "./entity-table-ddl";
import { getRecordStore, isHybridTablesEnabled } from "./record-store";

/**
 * Chọn tên bảng thật cho entity. Ưu tiên TÊN BẢNG DB CŨ (meta.source.mssqlTable)
 * để bảng thật mang đúng tên gốc; fallback er_<id> khi:
 *   - không có nguồn,
 *   - tên trùng BẢNG HỆ THỐNG (chống đè bảng lõi),
 *   - tên đã được entity KHÁC dùng (bảng vật lý không chia sẻ được — chống
 *     trộn 2 entity vào 1 bảng).
 * Nếu tên hợp lệ và bảng đã tồn tại (re-run/đổi tên) → vẫn trả tên đó để adopt.
 */
export async function resolveTableName(
  db: DB,
  entityId: string,
  sourceTable: string | undefined | null,
): Promise<string> {
  const fallback = tableNameForEntity(entityId);
  if (!sourceTable) return fallback;
  let desired: string;
  try {
    desired = safeTableIdent(sourceTable);
  } catch {
    return fallback;
  }
  if (desired === fallback) return desired;
  if (SYSTEM_TABLES.has(desired)) return fallback;
  // Tên đã thuộc entity KHÁC (bất kỳ công ty — bảng vật lý là global) → fallback.
  const others = await db
    .select({ id: entities.id })
    .from(entities)
    .where(
      and(ne(entities.id, entityId), sql`(${entities.meta}->'storage'->>'tableName') = ${desired}`),
    )
    .limit(1);
  if (others.length > 0) return fallback;
  return desired;
}

export interface PromoteResult {
  tableName: string;
  /** Số record copy thành công. */
  migrated: number;
  /** Số record đếm được trong bảng thật sau copy (verify). */
  total: number;
  errors: Array<{ id: string; message: string }>;
  alreadyTable?: boolean;
}

type EavRow = typeof entityRecords.$inferSelect;

/** INSERT 1 record vào bảng thật, GIỮ id + cột hệ thống. ON CONFLICT id DO NOTHING. */
async function insertCopy(
  db: DB,
  storage: EntityStorage,
  companyId: string,
  r: EavRow,
): Promise<void> {
  const tbl = sql.raw(`"${storage.tableName}"`);
  const data = (r.data ?? {}) as Record<string, unknown>;
  const { cols, ext } = splitDataForStorage(storage, data);
  const colList = [
    "id",
    "company_id",
    "version",
    "deleted_at",
    "rollup_cache",
    "rollup_invalidated",
    "created_by",
    "created_at",
    "updated_at",
    ...cols.map((c) => `"${c.col}"`),
    "ext",
  ];
  const vals = [
    sql`${r.id}::uuid`,
    sql`${companyId}::uuid`,
    sql`${r.version ?? 0}`,
    r.deletedAt ? sql`${r.deletedAt.toISOString()}::timestamptz` : sql`NULL`,
    r.rollupCache != null ? sql`${JSON.stringify(r.rollupCache)}::jsonb` : sql`NULL`,
    sql`${r.rollupInvalidated ?? true}`,
    r.createdBy ? sql`${r.createdBy}::uuid` : sql`NULL`,
    sql`${r.createdAt.toISOString()}::timestamptz`,
    sql`${r.updatedAt.toISOString()}::timestamptz`,
    ...cols.map((c) => sql`${c.value}`),
    sql`${JSON.stringify(ext)}::jsonb`,
  ];
  // search_tsv từ field searchable (giữ full-text khi copy sang bảng thật).
  const tsv = (storage.searchable ?? [])
    .map((f) => (data[f] == null ? "" : String(data[f])))
    .filter(Boolean)
    .join(" ");
  if (tsv) {
    colList.push("search_tsv");
    vals.push(sql`to_tsvector('simple', ${tsv})`);
  }
  await db.execute(
    sql`INSERT INTO ${tbl} (${sql.raw(colList.join(", "))}) VALUES (${sql.join(vals, sql`, `)}) ON CONFLICT (id) DO NOTHING`,
  );
}

export async function promoteEntityToTable(
  db: DB,
  companyId: string,
  entityId: string,
): Promise<PromoteResult> {
  if (!isHybridTablesEnabled()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Lưu trữ HYBRID chưa bật (ERP_HYBRID_TABLES=1) — không thể nâng cấp bảng thật.",
    });
  }
  const [ent] = await db
    .select({ fields: entities.fields, meta: entities.meta, label: entities.label })
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.companyId, companyId)));
  if (!ent) throw new TRPCError({ code: "NOT_FOUND", message: "Entity không tồn tại" });

  const existing = (ent.meta as { storage?: EntityStorage } | null)?.storage;
  if (existing?.tier === "table") {
    return { tableName: existing.tableName, migrated: 0, total: 0, errors: [], alreadyTable: true };
  }

  const fields = (ent.fields ?? []) as EntityFieldDef[];
  // Tên bảng thật theo BẢNG DB CŨ (meta.source.mssqlTable) nếu có — fallback er_<id>.
  const sourceTable = (ent.meta as { source?: { mssqlTable?: string } } | null)?.source?.mssqlTable;
  const tableName = await resolveTableName(db, entityId, sourceTable);
  const storage = await ensureEntityTable(db, entityId, fields, tableName);
  // Nhãn field → COMMENT ON COLUMN trên bảng thật (+ nhãn entity → COMMENT ON TABLE).
  await applyColumnLabels(db, storage, fields, ent.label ?? undefined);

  const errors: Array<{ id: string; message: string }> = [];
  let migrated = 0;
  const BATCH = 500;
  let offset = 0;
  for (;;) {
    const rows = (await db
      .select()
      .from(entityRecords)
      .where(and(eq(entityRecords.companyId, companyId), eq(entityRecords.entityId, entityId)))
      .orderBy(asc(entityRecords.createdAt))
      .limit(BATCH)
      .offset(offset)) as EavRow[];
    if (rows.length === 0) break;
    const okIds: Array<{ id: string; companyId: string; entityId: string }> = [];
    for (const r of rows) {
      try {
        await insertCopy(db, storage, companyId, r);
        migrated += 1;
        okIds.push({ id: r.id, companyId, entityId });
      } catch (e) {
        errors.push({ id: r.id, message: (e as Error).message });
      }
    }
    if (okIds.length > 0) {
      await db.insert(recordLocator).values(okIds).onConflictDoNothing();
    }
    offset += rows.length;
    if (rows.length < BATCH) break;
  }

  // Verify: đếm record trong bảng thật.
  const counted = (await db.execute(
    sql`SELECT count(*)::int AS count FROM ${sql.raw(`"${storage.tableName}"`)}`,
  )) as unknown as Array<{ count: number }>;
  const total = Number(counted[0]?.count ?? 0);

  // Flip meta.storage atomic → reads/writes sau đó đi vào bảng thật.
  const meta = { ...((ent.meta ?? {}) as Record<string, unknown>), storage };
  await db
    .update(entities)
    .set({ meta, updatedAt: new Date() })
    .where(and(eq(entities.id, entityId), eq(entities.companyId, companyId)));

  return { tableName: storage.tableName, migrated, total, errors };
}

export interface DemoteResult {
  migrated: number;
  errors: Array<{ id: string; message: string }>;
  alreadyEav?: boolean;
}

/**
 * Rollback: bảng thật er_<id> → EAV (entity_records). Copy mọi record (gồm soft-
 * deleted) GIỮ id/version/timestamp/deleted_at qua upsert (ghi đè bản đông lạnh
 * lúc promote), xoá meta.storage (entity về EAV), xoá record_locator, DROP bảng er_.
 *
 * LƯU Ý: record đã HARD-delete khỏi er_ sau promote sẽ "sống lại" từ bản đông lạnh
 * entity_records (hiếm — hard-delete là op admin). Chạy khi cờ HYBRID còn bật.
 */
export async function demoteEntityToEav(
  db: DB,
  companyId: string,
  entityId: string,
): Promise<DemoteResult> {
  const [ent] = await db
    .select({ meta: entities.meta })
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.companyId, companyId)));
  if (!ent) throw new TRPCError({ code: "NOT_FOUND", message: "Entity không tồn tại" });
  const storage = (ent.meta as { storage?: EntityStorage } | null)?.storage;
  if (storage?.tier !== "table") return { migrated: 0, errors: [], alreadyEav: true };

  // Đọc TỪ bảng thật (meta vẫn table) → ghi NGƯỢC vào entity_records.
  const store = getRecordStore(db);
  const errors: Array<{ id: string; message: string }> = [];
  let migrated = 0;
  const BATCH = 500;
  let offset = 0;
  for (;;) {
    const { rows } = await store.list(companyId, entityId, {
      includeDeleted: true,
      limit: BATCH,
      offset,
      withTotal: false,
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      try {
        const data = r.data as Record<string, unknown>;
        await db
          .insert(entityRecords)
          .values({
            id: r.id,
            companyId,
            entityId,
            schemaVersion: r.schemaVersion ?? "1",
            data,
            version: r.version,
            deletedAt: r.deletedAt,
            createdBy: r.createdBy ?? null,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          })
          .onConflictDoUpdate({
            target: entityRecords.id,
            set: { data, version: r.version, deletedAt: r.deletedAt, updatedAt: r.updatedAt },
          });
        migrated += 1;
      } catch (e) {
        errors.push({ id: r.id, message: (e as Error).message });
      }
    }
    offset += rows.length;
    if (rows.length < BATCH) break;
  }

  // Bỏ meta.storage → entity về EAV; dọn locator + DROP bảng er_.
  await db
    .update(entities)
    .set({ meta: sql`${entities.meta} - 'storage'`, updatedAt: new Date() })
    .where(and(eq(entities.id, entityId), eq(entities.companyId, companyId)));
  await db
    .delete(recordLocator)
    .where(and(eq(recordLocator.companyId, companyId), eq(recordLocator.entityId, entityId)));
  // DROP đúng bảng đang dùng (có thể là tên DB cũ, KHÔNG luôn là er_<id>).
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${storage.tableName}"`));

  return { migrated, errors };
}

export interface CleanupEavResult {
  /** Số dòng entity_records đã xoá. */
  deleted: number;
  /** true = GIỮ EAV (không xoá) vì chưa an toàn / không cần. */
  kept: boolean;
  reason?: string;
}

/**
 * DỌN bản EAV (entity_records) sau khi entity đã ở BẢNG THẬT — hard delete.
 * AN TOÀN có verify: chỉ xoá khi
 *   (a) entity tier='table', và
 *   (b) ĐẾM KHỚP: count bảng thật >= count EAV (mọi dòng đã sang bảng thật).
 * Sau migration 0071 các bảng phụ (versions/embeddings/…) đã BỎ FK record_id
 * → xoá entity_records KHÔNG cascade mất history. Đánh đổi: mất khả năng demote
 * "sống lại" cho dòng đã hard-delete khỏi er_ (hiếm). Idempotent (EAV rỗng → no-op).
 */
export async function cleanupEavForEntity(
  db: DB,
  companyId: string,
  entityId: string,
): Promise<CleanupEavResult> {
  const [ent] = await db
    .select({ meta: entities.meta })
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.companyId, companyId)));
  if (!ent) throw new TRPCError({ code: "NOT_FOUND", message: "Entity không tồn tại" });
  const storage = (ent.meta as { storage?: EntityStorage } | null)?.storage;
  if (storage?.tier !== "table") {
    return { deleted: 0, kept: true, reason: "Entity chưa ở bảng thật — không dọn EAV." };
  }

  const countOf = async (q: ReturnType<typeof sql>): Promise<number> => {
    const res = (await db.execute(q)) as unknown as
      | Array<{ n: number }>
      | { rows: Array<{ n: number }> };
    const list = Array.isArray(res) ? res : (res.rows ?? []);
    return Number(list[0]?.n ?? 0);
  };

  const eavCount = await countOf(
    sql`SELECT count(*)::int AS n FROM entity_records WHERE company_id = ${companyId}::uuid AND entity_id = ${entityId}::uuid`,
  );
  if (eavCount === 0) return { deleted: 0, kept: false };

  const realCount = await countOf(
    sql`SELECT count(*)::int AS n FROM ${sql.raw(`"${storage.tableName}"`)} WHERE company_id = ${companyId}::uuid`,
  );
  if (realCount < eavCount) {
    return {
      deleted: 0,
      kept: true,
      reason: `Bảng thật ${realCount} < EAV ${eavCount} dòng — GIỮ EAV (chưa khớp, có thể promote/import chưa xong).`,
    };
  }

  const res = await db
    .delete(entityRecords)
    .where(and(eq(entityRecords.companyId, companyId), eq(entityRecords.entityId, entityId)))
    .returning({ id: entityRecords.id });
  return { deleted: res.length, kept: false };
}

/** DROP bảng thật + dọn locator khi xoá hẳn entity tier='table'. Bảng vật lý
 *  KHÔNG nằm trong cascade FK của entities nên phải drop tường minh. */
export async function dropTableForEntity(
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

export interface RenameTableResult {
  entityId: string;
  label: string;
  from: string;
  to: string;
  status: "renamed" | "skip" | "error";
  reason?: string;
}

/**
 * Đổi tên các bảng thật đã promote (er_<id>) sang ĐÚNG tên bảng DB cũ
 * (meta.source.mssqlTable). Bỏ qua mục đã đúng tên / không có nguồn / tên
 * trùng (system, entity khác, bảng vật lý đã tồn tại). Cập nhật
 * meta.storage.tableName + ghi lại COMMENT nhãn cột.
 * Logic dùng chung cho tRPC migration.renamePromotedTablesToSource và
 * MCP /mcp/migration (tool migration_rename_promoted_tables).
 */
export async function renamePromotedTablesForCompany(
  db: DB,
  companyId: string,
): Promise<{ results: RenameTableResult[]; renamed: number }> {
  const rows = await db
    .select({
      id: entities.id,
      label: entities.label,
      fields: entities.fields,
      meta: entities.meta,
    })
    .from(entities)
    .where(eq(entities.companyId, companyId));

  const results: RenameTableResult[] = [];

  for (const e of rows) {
    const meta = (e.meta ?? {}) as Record<string, unknown>;
    const storage = (meta as { storage?: EntityStorage }).storage;
    const source = (meta as { source?: { mssqlTable?: string } }).source?.mssqlTable;
    if (storage?.tier !== "table" || !source) continue;
    const from = storage.tableName;
    const to = await resolveTableName(db, e.id, source);
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
    const reg = (await db.execute(sql`SELECT to_regclass(${to}) AS reg`)) as unknown as
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
      await db.execute(sql.raw(renameTableDDL(from, to)));
      const nextStorage: EntityStorage = { ...storage, tableName: to };
      await db
        .update(entities)
        .set({ meta: { ...meta, storage: nextStorage }, updatedAt: new Date() })
        .where(eq(entities.id, e.id));
      await applyColumnLabels(
        db,
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
  return { results, renamed: results.filter((r) => r.status === "renamed").length };
}
