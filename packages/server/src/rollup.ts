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

/** Mở rộng data object với giá trị các field rollup. */
export async function applyRollups(
  db: DB, companyId: string,
  fields: EntityFieldDef[], recordId: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const rollupFields = fields.filter((f) => f.type === "rollup" && f.rollup);
  if (rollupFields.length === 0) return data;
  const out = { ...data };
  await Promise.all(rollupFields.map(async (f) => {
    out[f.name] = await computeRollup(db, companyId, recordId, f.rollup!);
  }));
  return out;
}
