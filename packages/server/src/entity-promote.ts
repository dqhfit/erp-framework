/* ==========================================================
   entity-promote.ts — Nâng cấp một entity từ EAV (entity_records) sang
   bảng thật er_<id> (Phase 2). CHỈ chạy khi ERP_HYBRID_TABLES=1.

   Quy trình: ensureEntityTable → copy mọi record (GIỮ NGUYÊN id/version/
   timestamp/deleted_at + ciphertext field encrypted ở ext) → ghi locator →
   verify count → flip entities.meta.storage atomic.

   KHÔNG xoá entity_records cũ: entity_record_versions/embeddings còn FK trỏ
   tới id đó (cascade) → giữ lại để bảo toàn lịch sử; chúng thành snapshot
   đông lạnh (reads/writes sau đó đi vào bảng thật). Dọn EAV là bước sau,
   thủ công/Phase later.

   CHƯA verify runtime — cần Postgres e2e.
   ========================================================== */

import type { EntityFieldDef } from "@erp-framework/core";
import { entities, entityRecords, recordLocator } from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, sql } from "drizzle-orm";
import type { DB } from "./db";
import { coerceColumnValue, ensureEntityTable, type EntityStorage } from "./entity-table-ddl";
import { isHybridTablesEnabled } from "./record-store";

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

/** Tách data theo storage.columns → giá trị cột (coerce) + phần ext còn lại. */
function split(
  storage: EntityStorage,
  data: Record<string, unknown>,
): { cols: Array<{ col: string; value: unknown }>; ext: Record<string, unknown> } {
  const cols: Array<{ col: string; value: unknown }> = [];
  const ext: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    const m = storage.columns[k];
    if (m) cols.push({ col: m.col, value: coerceColumnValue(m.pgType, v) });
    else ext[k] = v; // field encrypted → ciphertext giữ nguyên ở ext
  }
  return { cols, ext };
}

/** INSERT 1 record vào bảng thật, GIỮ id + cột hệ thống. ON CONFLICT id DO NOTHING. */
async function insertCopy(
  db: DB,
  storage: EntityStorage,
  companyId: string,
  r: EavRow,
): Promise<void> {
  const tbl = sql.raw(`"${storage.tableName}"`);
  const { cols, ext } = split(storage, (r.data ?? {}) as Record<string, unknown>);
  const names = [
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
  ].join(", ");
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
  await db.execute(
    sql`INSERT INTO ${tbl} (${sql.raw(names)}) VALUES (${sql.join(vals, sql`, `)}) ON CONFLICT (id) DO NOTHING`,
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
    .select({ fields: entities.fields, meta: entities.meta })
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.companyId, companyId)));
  if (!ent) throw new TRPCError({ code: "NOT_FOUND", message: "Entity không tồn tại" });

  const existing = (ent.meta as { storage?: EntityStorage } | null)?.storage;
  if (existing?.tier === "table") {
    return { tableName: existing.tableName, migrated: 0, total: 0, errors: [], alreadyTable: true };
  }

  const fields = (ent.fields ?? []) as EntityFieldDef[];
  const storage = await ensureEntityTable(db, entityId, fields);

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
