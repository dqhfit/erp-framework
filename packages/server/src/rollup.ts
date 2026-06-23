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
