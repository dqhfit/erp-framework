/* ==========================================================
   rollup.ts — Server compute rollup field (aggregate cross-row).
   Lazy: tính tại records.get/list, không cache. v2 sẽ thêm
   incremental + materialized view cho perf.
   HYBRID-aware: entity tier='table' → aggregate/cache trên bảng thật
   (cột typed hoặc ext jsonb); EAV → entity_records.data như cũ.
   ========================================================== */

import type { EntityFieldDef, RollupConfig } from "@erp-framework/core";
import { entities, entityRecords, recordLocator } from "@erp-framework/db";
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "./db";
import { assertIdent, type EntityStorage } from "./entity-table-ddl";

/** storage tier='table' từ meta entity, hoặc null nếu còn EAV. */
function storageOf(meta: unknown): EntityStorage | null {
  const s = (meta as { storage?: EntityStorage } | null)?.storage;
  return s?.tier === "table" ? s : null;
}

/** Biểu thức SQL đọc 1 field trên bảng thật: cột typed hoặc ext jsonb. */
function tableFieldExpr(storage: EntityStorage, field: string) {
  const col = storage.columns[field]?.col;
  return col ? sql.raw(`"${assertIdent(col)}"`) : sql`(ext->>${field})`;
}

/** Compute 1 rollup field cho 1 record. Trả null nếu lỗi/không match. */
async function computeRollup(
  db: DB,
  companyId: string,
  // Giá trị để khớp fkField của bản ghi con: mặc định = record.id (uuid), hoặc
  // giá trị khoá nghiệp vụ (vd maddh) khi cfg.parentKeyField được đặt.
  matchValue: string,
  cfg: RollupConfig,
): Promise<number | null> {
  // Lookup entity nguồn theo name (vd "order") — kèm meta để biết tier.
  const [from] = await db
    .select({ id: entities.id, meta: entities.meta })
    .from(entities)
    .where(and(eq(entities.companyId, companyId), eq(entities.name, cfg.fromEntityName)));
  if (!from) return null;

  const storage = storageOf(from.meta);
  if (storage) {
    // Bảng thật: agg trên cột typed / ext jsonb.
    const tbl = sql.raw(`"${assertIdent(storage.tableName)}"`);
    const aggExpr =
      cfg.agg === "count"
        ? sql`count(*)::float`
        : cfg.valueField
          ? sql`${
              cfg.agg === "sum"
                ? sql.raw("sum")
                : cfg.agg === "avg"
                  ? sql.raw("avg")
                  : cfg.agg === "min"
                    ? sql.raw("min")
                    : sql.raw("max")
            }((${tableFieldExpr(storage, cfg.valueField)})::numeric)::float`
          : sql`0::float`;
    const res = (await db.execute(sql`
      SELECT ${aggExpr} AS v FROM ${tbl}
      WHERE company_id = ${companyId}::uuid
        AND deleted_at IS NULL
        AND (${tableFieldExpr(storage, cfg.fkField)})::text = ${matchValue}
    `)) as unknown as Array<{ v: number | null }> | { rows?: Array<{ v: number | null }> };
    const list = Array.isArray(res) ? res : (res.rows ?? []);
    return (list[0]?.v as number | null) ?? 0;
  }

  // EAV: query records nguồn có fkField trỏ tới recordId (active only).
  const aggExpr =
    cfg.agg === "count"
      ? sql`count(*)::float`
      : cfg.valueField
        ? sql`${
            cfg.agg === "sum"
              ? sql.raw("sum")
              : cfg.agg === "avg"
                ? sql.raw("avg")
                : cfg.agg === "min"
                  ? sql.raw("min")
                  : sql.raw("max")
          }((${entityRecords.data}->>${cfg.valueField})::numeric)::float`
        : sql`0::float`;

  const [row] = await db
    .select({ v: aggExpr })
    .from(entityRecords)
    .where(
      and(
        eq(entityRecords.companyId, companyId),
        eq(entityRecords.entityId, from.id),
        sql`${entityRecords.deletedAt} IS NULL`,
        sql`${entityRecords.data}->>${cfg.fkField} = ${matchValue}`,
      ),
    );
  return (row?.v as number | null) ?? 0;
}

/** Helper: raw SQL cho ham agg (sum/avg/min/max). */
function aggRaw(agg: "sum" | "avg" | "min" | "max") {
  return agg === "sum"
    ? sql.raw("sum")
    : agg === "avg"
      ? sql.raw("avg")
      : agg === "min"
        ? sql.raw("min")
        : sql.raw("max");
}

/** Batch compute rollup values cho nhieu matchValues cung luc (1 query/field).
 *  Tra Map<matchValue, aggregatedValue>. Dung cho records.list batch thay vi
 *  N lan computeRollup don le (N x M queries -> 1 query/rollup-field). */
async function computeRollupBatch(
  db: DB,
  companyId: string,
  matchValues: string[],
  cfg: RollupConfig,
): Promise<Map<string, number>> {
  if (matchValues.length === 0) return new Map();

  const [from] = await db
    .select({ id: entities.id, meta: entities.meta })
    .from(entities)
    .where(and(eq(entities.companyId, companyId), eq(entities.name, cfg.fromEntityName)));
  if (!from) return new Map();

  const result = new Map<string, number>();
  const storage = storageOf(from.meta);

  if (storage) {
    // Bảng thật: GROUP BY FK field, filter = ANY(matchValues).
    const tbl = sql.raw(`"${assertIdent(storage.tableName)}"`);
    const fkExpr = tableFieldExpr(storage, cfg.fkField);
    const valExpr = cfg.valueField ? tableFieldExpr(storage, cfg.valueField) : null;
    const aggExpr =
      cfg.agg === "count"
        ? sql`count(*)::float`
        : valExpr
          ? sql`${aggRaw(cfg.agg as "sum" | "avg" | "min" | "max")}((${valExpr})::numeric)::float`
          : sql`0::float`;
    type TblRow = { mv: string; v: number | null };
    const rawRes = await db.execute(sql`
      SELECT (${fkExpr})::text AS mv, ${aggExpr} AS v
      FROM ${tbl}
      WHERE company_id = ${companyId}::uuid
        AND deleted_at IS NULL
        AND (${fkExpr})::text = ANY(${matchValues}::text[])
      GROUP BY (${fkExpr})::text
    `);
    const rows: TblRow[] = Array.isArray(rawRes)
      ? (rawRes as unknown as TblRow[])
      : ((rawRes as unknown as { rows?: TblRow[] }).rows ?? []);
    for (const r of rows) result.set(r.mv, r.v ?? 0);
    return result;
  }

  // EAV: GROUP BY fkField trong entity_records.
  const fkTextExpr = sql`${entityRecords.data}->>${cfg.fkField}`;
  const aggEavExpr =
    cfg.agg === "count"
      ? sql`count(*)::float`
      : cfg.valueField
        ? sql`${aggRaw(cfg.agg as "sum" | "avg" | "min" | "max")}((${entityRecords.data}->>${cfg.valueField})::numeric)::float`
        : sql`0::float`;
  const dbRows = await db
    .select({ mv: fkTextExpr, v: aggEavExpr })
    .from(entityRecords)
    .where(
      and(
        eq(entityRecords.companyId, companyId),
        eq(entityRecords.entityId, from.id),
        sql`${entityRecords.deletedAt} IS NULL`,
        sql`${entityRecords.data}->>${cfg.fkField} = ANY(${matchValues}::text[])`,
      ),
    )
    .groupBy(fkTextExpr);
  for (const r of dbRows) {
    if (r.mv != null) result.set(r.mv as string, (r.v as number | null) ?? 0);
  }
  return result;
}

/** Batch apply rollup cho toan page records (1 query/field thay vi N x M).
 *  - Row co cache hop le (rollupInvalidated=false, tat ca field co gia tri) -> dung cache.
 *  - Cac row con lai gom matchValues -> 1 computeRollupBatch/field.
 *  Tra mang data[] tuong ung moi input row. */
export async function applyRollupsBatch(
  db: DB,
  companyId: string,
  fields: EntityFieldDef[],
  rows: Array<{
    id: string;
    data: Record<string, unknown>;
    rollupCache: unknown;
    rollupInvalidated: boolean | null | undefined;
  }>,
): Promise<Array<Record<string, unknown>>> {
  const rollupFields = fields.filter((f) => f.type === "rollup" && f.rollup);
  if (rollupFields.length === 0) return rows.map((r) => r.data);

  type CacheMap = Record<string, { v: unknown; computedAt: string }>;
  const rowCaches: CacheMap[] = rows.map((r) => (r.rollupCache ?? {}) as CacheMap);

  // Phan loai: row can recompute (invalidated hoac thieu cache bat ky field nao).
  const needCompute: boolean[] = rows.map(
    (r, i) => !!r.rollupInvalidated || rollupFields.some((f) => rowCaches[i]![f.name] == null),
  );

  // Gom matchValues (unique) cho moi field, chi cho cac row can compute.
  const toComputeByField = new Map<string, string[]>();
  for (const f of rollupFields) {
    const vals = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      if (!needCompute[i]) continue;
      const r = rows[i]!;
      const mv = f.rollup!.parentKeyField ? String(r.data[f.rollup!.parentKeyField] ?? "") : r.id;
      vals.add(mv);
    }
    toComputeByField.set(f.name, [...vals]);
  }

  // 1 query/rollup-field cho tat ca matchValues cua page.
  const computedByField = new Map<string, Map<string, number>>();
  for (const f of rollupFields) {
    const matchValues = toComputeByField.get(f.name) ?? [];
    computedByField.set(f.name, await computeRollupBatch(db, companyId, matchValues, f.rollup!));
  }

  // Ap ket qua vao tung row.
  return rows.map((r, i) => {
    const out = { ...r.data };
    const cache = rowCaches[i]!;
    for (const f of rollupFields) {
      if (!needCompute[i] && cache[f.name] != null) {
        // Cache hit: dung gia tri da luu.
        out[f.name] = cache[f.name]!.v;
      } else {
        const mv = f.rollup!.parentKeyField ? String(r.data[f.rollup!.parentKeyField] ?? "") : r.id;
        out[f.name] = computedByField.get(f.name)?.get(mv) ?? 0;
      }
    }
    return out;
  });
}

/** Tên bảng thật chứa recordId (qua record_locator), hoặc null nếu record EAV. */
async function tableNameOfRecord(
  db: DB,
  companyId: string,
  recordId: string,
): Promise<string | null> {
  const [loc] = await db
    .select({ entityId: recordLocator.entityId })
    .from(recordLocator)
    .where(and(eq(recordLocator.id, recordId), eq(recordLocator.companyId, companyId)));
  if (!loc) return null;
  const [ent] = await db
    .select({ meta: entities.meta })
    .from(entities)
    .where(and(eq(entities.id, loc.entityId), eq(entities.companyId, companyId)));
  return storageOf(ent?.meta)?.tableName ?? null;
}

/** Mở rộng data object với giá trị các field rollup. Có cache: nếu
 *  rollup_invalidated=false và rollup_cache có giá trị → dùng cache.
 *  Ngược lại recompute + ghi cache + clear invalidated flag. */
export async function applyRollups(
  db: DB,
  companyId: string,
  fields: EntityFieldDef[],
  recordId: string,
  data: Record<string, unknown>,
  cache?: { rollupCache: unknown; rollupInvalidated: boolean } | null,
): Promise<Record<string, unknown>> {
  const rollupFields = fields.filter((f) => f.type === "rollup" && f.rollup);
  if (rollupFields.length === 0) return data;
  const out = { ...data };
  const cached = (cache?.rollupCache ?? {}) as Record<string, { v: unknown; computedAt: string }>;
  // Cache hit nếu không invalidated và tất cả field có entry.
  const allCached = !cache?.rollupInvalidated && rollupFields.every((f) => cached[f.name] != null);
  if (allCached) {
    for (const f of rollupFields) out[f.name] = cached[f.name]!.v;
    return out;
  }
  // Recompute + ghi cache.
  const newCache: Record<string, { v: unknown; computedAt: string }> = {};
  await Promise.all(
    rollupFields.map(async (f) => {
      // Khớp theo khoá nghiệp vụ (parentKeyField, vd maddh) nếu cấu hình; mặc
      // định theo record.id (uuid).
      const matchValue = f.rollup!.parentKeyField
        ? String(data[f.rollup!.parentKeyField] ?? "")
        : recordId;
      const v = await computeRollup(db, companyId, matchValue, f.rollup!);
      out[f.name] = v;
      newCache[f.name] = { v, computedAt: new Date().toISOString() };
    }),
  );
  // Best-effort cache write (lỗi không cản trở serve). Record có thể sống ở
  // bảng thật (tier='table') — route qua record_locator.
  try {
    const realTable = await tableNameOfRecord(db, companyId, recordId);
    const tbl = sql.raw(`"${assertIdent(realTable ?? "entity_records")}"`);
    await db.execute(sql`
      UPDATE ${tbl}
        SET rollup_cache = ${JSON.stringify(newCache)}::jsonb,
            rollup_invalidated = false
      WHERE id = ${recordId}::uuid AND company_id = ${companyId}::uuid
    `);
  } catch (e) {
    console.error("[rollup] cache write lỗi:", (e as Error).message);
  }
  return out;
}

/** Invalidate rollup cache cho tất cả record có rollup field trỏ tới
 *  source entity. Gọi khi records.create/update/delete trên entity nguồn.
 *  Chính xác: scan entities trong company, tìm field rollup với
 *  fromEntityName khớp; mark rollup_invalidated cho record đích. */
export async function invalidateRollupsFor(
  db: DB,
  companyId: string,
  sourceEntityName: string,
): Promise<void> {
  try {
    // Scan entities có field rollup trỏ tới source — kèm meta để biết tier.
    const allEnts = await db
      .select({ id: entities.id, fields: entities.fields, meta: entities.meta })
      .from(entities)
      .where(eq(entities.companyId, companyId));
    const targets: Array<{ id: string; storage: EntityStorage | null }> = [];
    for (const e of allEnts) {
      const fields = (e.fields ?? []) as EntityFieldDef[];
      if (
        fields.some((f) => f.type === "rollup" && f.rollup?.fromEntityName === sourceEntityName)
      ) {
        targets.push({ id: e.id, storage: storageOf(e.meta) });
      }
    }
    if (targets.length === 0) return;
    // Mark invalidated cho mọi record của các entity đích (theo tier).
    for (const t of targets) {
      if (t.storage) {
        await db.execute(sql`
          UPDATE ${sql.raw(`"${assertIdent(t.storage.tableName)}"`)}
            SET rollup_invalidated = true
          WHERE company_id = ${companyId}::uuid
        `);
      } else {
        await db.execute(sql`
          UPDATE entity_records SET rollup_invalidated = true
          WHERE entity_id = ${t.id}::uuid AND company_id = ${companyId}::uuid
        `);
      }
    }
  } catch (e) {
    console.error("[rollup] invalidate lỗi:", (e as Error).message);
  }
}
