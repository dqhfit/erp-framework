/* ==========================================================
   rollup.ts — Server compute rollup field (aggregate cross-row).
   Lazy: tính tại records.get/list, không cache. v2 sẽ thêm
   incremental + materialized view cho perf.
   ========================================================== */
import { and, eq, sql } from "drizzle-orm";
import { entities, entityRecords } from "@erp-framework/db";
import type { EntityFieldDef, RollupConfig } from "@erp-framework/core";
import type { DB } from "./db";

/** Compute 1 rollup field cho 1 record. Trả null nếu lỗi/không match. */
async function computeRollup(
  db: DB, companyId: string, recordId: string, cfg: RollupConfig,
): Promise<number | null> {
  // Lookup entity nguồn theo name (vd "order").
  const [from] = await db.select({ id: entities.id }).from(entities)
    .where(and(eq(entities.companyId, companyId), eq(entities.name, cfg.fromEntityName)));
  if (!from) return null;

  // Query records nguồn có fkField trỏ tới recordId (active only).
  const aggExpr = cfg.agg === "count"
    ? sql`count(*)::float`
    : cfg.valueField
      ? sql`${cfg.agg === "sum" ? sql.raw("sum")
          : cfg.agg === "avg" ? sql.raw("avg")
          : cfg.agg === "min" ? sql.raw("min")
          : sql.raw("max")}((${entityRecords.data}->>${cfg.valueField})::numeric)::float`
      : sql`0::float`;

  const [row] = await db.select({ v: aggExpr }).from(entityRecords).where(and(
    eq(entityRecords.companyId, companyId),
    eq(entityRecords.entityId, from.id),
    sql`${entityRecords.deletedAt} IS NULL`,
    sql`${entityRecords.data}->>${cfg.fkField} = ${recordId}`,
  ));
  return (row?.v as number | null) ?? 0;
}

/** Mở rộng data object với giá trị các field rollup. Có cache: nếu
 *  rollup_invalidated=false và rollup_cache có giá trị → dùng cache.
 *  Ngược lại recompute + ghi cache + clear invalidated flag. */
export async function applyRollups(
  db: DB, companyId: string,
  fields: EntityFieldDef[], recordId: string,
  data: Record<string, unknown>,
  cache?: { rollupCache: unknown; rollupInvalidated: boolean } | null,
): Promise<Record<string, unknown>> {
  const rollupFields = fields.filter((f) => f.type === "rollup" && f.rollup);
  if (rollupFields.length === 0) return data;
  const out = { ...data };
  const cached = (cache?.rollupCache ?? {}) as Record<string, { v: unknown; computedAt: string }>;
  // Cache hit nếu không invalidated và tất cả field có entry.
  const allCached = !cache?.rollupInvalidated
    && rollupFields.every((f) => cached[f.name] != null);
  if (allCached) {
    for (const f of rollupFields) out[f.name] = cached[f.name]!.v;
    return out;
  }
  // Recompute + ghi cache.
  const newCache: Record<string, { v: unknown; computedAt: string }> = {};
  await Promise.all(rollupFields.map(async (f) => {
    const v = await computeRollup(db, companyId, recordId, f.rollup!);
    out[f.name] = v;
    newCache[f.name] = { v, computedAt: new Date().toISOString() };
  }));
  // Best-effort cache write (lỗi không cản trở serve).
  try {
    await db.execute(sql`
      UPDATE entity_records
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
  db: DB, companyId: string, sourceEntityName: string,
): Promise<void> {
  try {
    // Scan entities có field rollup trỏ tới source.
    const allEnts = await db.select({ id: entities.id, fields: entities.fields })
      .from(entities).where(eq(entities.companyId, companyId));
    const targetEntityIds: string[] = [];
    for (const e of allEnts) {
      const fields = (e.fields ?? []) as EntityFieldDef[];
      if (fields.some((f) => f.type === "rollup"
          && f.rollup?.fromEntityName === sourceEntityName)) {
        targetEntityIds.push(e.id);
      }
    }
    if (targetEntityIds.length === 0) return;
    // Mark invalidated cho mọi record của các entity đích.
    for (const eid of targetEntityIds) {
      await db.execute(sql`
        UPDATE entity_records SET rollup_invalidated = true
        WHERE entity_id = ${eid}::uuid AND company_id = ${companyId}::uuid
      `);
    }
  } catch (e) {
    console.error("[rollup] invalidate lỗi:", (e as Error).message);
  }
}
