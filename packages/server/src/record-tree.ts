/* ==========================================================
   record-tree.ts — Tree traversal (descendants/ancestors) qua self-ref lookup,
   backend-aware (HYBRID Phase 4b). Entity EAV → recursive CTE trên entity_records;
   entity tier='table' → CTE trên er_<id> (cột FK / ext) lấy id+level rồi reconstruct
   `data` qua RecordStore. Locate backend qua record_locator (chỉ chứa record bảng thật).
   ========================================================== */

import { entities, recordLocator } from "@erp-framework/db";
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "./db";
import { assertIdent, type EntityStorage } from "./entity-table-ddl";
import { getRecordStore } from "./record-store";

export type TreeRow = { id: string; data: unknown; level: number };
export type TreeDir = "descendants" | "ancestors";

/** storage tier='table' của entity chứa recordId, hoặc null nếu EAV. */
async function locateStorage(
  db: DB,
  companyId: string,
  recordId: string,
): Promise<{ entityId: string; storage: EntityStorage } | null> {
  const [loc] = await db
    .select({ entityId: recordLocator.entityId })
    .from(recordLocator)
    .where(and(eq(recordLocator.id, recordId), eq(recordLocator.companyId, companyId)));
  if (!loc) return null;
  const [ent] = await db
    .select({ meta: entities.meta })
    .from(entities)
    .where(and(eq(entities.id, loc.entityId), eq(entities.companyId, companyId)));
  const s = (ent?.meta as { storage?: EntityStorage } | null)?.storage;
  return s?.tier === "table" ? { entityId: loc.entityId, storage: s } : null;
}

export async function recordTree(
  db: DB,
  companyId: string,
  recordId: string,
  fkField: string,
  maxDepth: number,
  dir: TreeDir,
): Promise<TreeRow[]> {
  const located = await locateStorage(db, companyId, recordId);

  if (!located) {
    // EAV: CTE trên entity_records (tree mang `data` trực tiếp).
    const joinCond =
      dir === "descendants"
        ? sql`er.data->>${fkField} = tree.id::text`
        : sql`tree.data->>${fkField} = er.id::text`;
    return (await db.execute(sql`
      WITH RECURSIVE tree AS (
        SELECT id, data, 0 AS level FROM entity_records
        WHERE id = ${recordId}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
        UNION ALL
        SELECT er.id, er.data, tree.level + 1 FROM entity_records er
        JOIN tree ON ${joinCond}
        WHERE er.company_id = ${companyId}::uuid AND er.deleted_at IS NULL
          AND tree.level < ${maxDepth}
      )
      SELECT id, data, level FROM tree WHERE level > 0 ORDER BY level
    `)) as unknown as TreeRow[];
  }

  // Table-backed: CTE trên er_<id> lấy id+level; reconstruct data qua store.
  const { entityId, storage } = located;
  const tbl = sql.raw(`"${assertIdent(storage.tableName)}"`);
  const col = storage.columns[fkField]?.col;
  const fkExpr = col ? sql.raw(`er."${assertIdent(col)}"`) : sql`er.ext->>${fkField}`;

  const cteRows = (await (dir === "descendants"
    ? db.execute(sql`
        WITH RECURSIVE tree AS (
          SELECT er.id, 0 AS level FROM ${tbl} er
          WHERE er.id = ${recordId}::uuid AND er.company_id = ${companyId}::uuid
            AND er.deleted_at IS NULL
          UNION ALL
          SELECT er.id, tree.level + 1 FROM ${tbl} er
          JOIN tree ON (${fkExpr})::text = tree.id::text
          WHERE er.company_id = ${companyId}::uuid AND er.deleted_at IS NULL
            AND tree.level < ${maxDepth}
        )
        SELECT id, level FROM tree WHERE level > 0 ORDER BY level
      `)
    : db.execute(sql`
        WITH RECURSIVE tree AS (
          SELECT er.id, (${fkExpr})::text AS fk, 0 AS level FROM ${tbl} er
          WHERE er.id = ${recordId}::uuid AND er.company_id = ${companyId}::uuid
            AND er.deleted_at IS NULL
          UNION ALL
          SELECT er.id, (${fkExpr})::text AS fk, tree.level + 1 FROM ${tbl} er
          JOIN tree ON tree.fk = er.id::text
          WHERE er.company_id = ${companyId}::uuid AND er.deleted_at IS NULL
            AND tree.level < ${maxDepth}
        )
        SELECT id, level FROM tree WHERE level > 0 ORDER BY level
      `))) as unknown as Array<{ id: string; level: number }>;

  if (cteRows.length === 0) return [];
  const recs = await getRecordStore(db).findByKeyIn(
    companyId,
    entityId,
    null,
    cteRows.map((r) => r.id),
  );
  const dataById = new Map(recs.map((r) => [r.id, r.data]));
  return cteRows.map((r) => ({
    id: r.id,
    data: dataById.get(r.id) ?? null,
    level: Number(r.level),
  }));
}
