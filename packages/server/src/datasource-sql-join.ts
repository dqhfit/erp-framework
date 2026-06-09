/* ==========================================================
   datasource-sql-join.ts — Nhánh JOIN SQL THẬT cho "Nguồn dữ liệu"
   (HYBRID Phase 3). Khi base + MỌI relation đều tier='table', sinh 1 câu
   SELECT … JOIN trên các bảng er_<id> để Postgres lo join/filter/sort/
   paginate → GỠ giới hạn v1 (filter/sort field JOIN không còn best-effort
   trên trang đã limit). Nếu không đủ điều kiện → trả null → caller fallback
   batch-stitch.

   ĐIỀU KIỆN (tryBuildJoinQuery trả null nếu vi phạm):
   - base + mọi relation target đều storage tier='table';
   - KHÔNG có aggregate (1-N/N-N) — giữ batch-stitch;
   - KHÔNG có full-text q (search_tsv cho er_* dựng sau) — fallback;
   - field tham gia JOIN-ON / WHERE / ORDER BY phải là CỘT typed (không
     encrypted, không ext) — else fallback (ciphertext/đa-trị không
     join/filter/sort SQL đúng được).
   Field CHIẾU (projection) thì cho cả cột lẫn ext (ext->>): encrypted sẽ
   decrypt + RBAC strip + computed eval ở JS sau khi fetch (projectJoinRow).

   Pure (không I/O) — build SQL từ config + storage map; execute + post-process
   ở datasource-resolver. CHƯA verify runtime — cần Postgres e2e.
   ========================================================== */

import {
  type DataSourceConfig,
  type DataSourceRelation,
  type DataSourceRow,
  type EntityFieldDef,
  evaluate,
  fieldCan,
  type Role,
} from "@erp-framework/core";
import { type SQL, sql } from "drizzle-orm";
import { assertIdent, type EntityStorage } from "./entity-table-ddl";
import { decryptField } from "./router-helpers";

/** entityId → storage (null = không phải bảng thật → không đủ điều kiện join SQL). */
export type StorageByEntity = Record<string, EntityStorage | null | undefined>;

export interface JoinQuery {
  filters?: Record<string, { op: string; value: unknown }>;
  q?: string;
  sort?: { key: string; dir: "asc" | "desc" };
  limit?: number;
  offset?: number;
}

export interface BuiltJoin {
  rowsSql: SQL;
  countSql: SQL;
}

/** Sắp relations cha-trước-con (alias cha phải xuất hiện trước trong FROM/JOIN). */
function orderRelations(relations: DataSourceRelation[]): DataSourceRelation[] {
  const out: DataSourceRelation[] = [];
  const done = new Set<string>();
  const pending = [...relations];
  let guard = 0;
  while (pending.length && guard++ < 1000) {
    let moved = false;
    for (let i = 0; i < pending.length; i++) {
      const r = pending[i]!;
      if (r.fromRelationId == null || done.has(r.fromRelationId)) {
        out.push(r);
        done.add(r.id);
        pending.splice(i, 1);
        i--;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out.concat(pending);
}

/** Định danh cột vật lý của field trên 1 node (null nếu không phải cột typed). */
function colName(storage: EntityStorage, fieldName: string): string | null {
  return storage.columns[fieldName]?.col ?? null;
}

/**
 * Thử build câu JOIN SQL cho config. Trả null nếu không đủ điều kiện (caller
 * fallback batch-stitch). companyId tham số hoá; identifier qua assertIdent+raw.
 */
export function tryBuildJoinQuery(
  cfg: DataSourceConfig,
  storages: StorageByEntity,
  companyId: string,
  query: JoinQuery,
): BuiltJoin | null {
  if (!cfg.baseEntityId) return null;
  if ((cfg.aggregates ?? []).length > 0) return null; // aggregate → batch-stitch
  if (query.q?.trim()) return null; // full-text trên bảng thật chưa hỗ trợ
  const baseStorage = storages[cfg.baseEntityId];
  if (baseStorage?.tier !== "table") return null;

  // Node → entityId, alias, storage.
  const entityByRid: Record<string, string> = { base: cfg.baseEntityId };
  const aliasByRid: Record<string, string> = { base: "b" };
  const relsOrdered = orderRelations(cfg.relations);
  relsOrdered.forEach((r, i) => {
    entityByRid[r.id] = r.targetEntityId;
    aliasByRid[r.id] = `j${i}`;
  });
  const storageOf = (rid: string): EntityStorage | null => {
    const eid = entityByRid[rid];
    const s = eid ? storages[eid] : null;
    return s?.tier === "table" ? s : null;
  };

  // FROM + JOIN. Mọi relation target phải là bảng; join-key phải là cột.
  const baseTbl = `"${assertIdent(baseStorage.tableName)}"`;
  const fromParts: SQL[] = [sql.raw(`${baseTbl} b`)];
  for (const r of relsOrdered) {
    const childStorage = storageOf(r.id);
    if (!childStorage) return null; // target không phải bảng
    const parentRid = r.fromRelationId ?? "base";
    const parentStorage = storageOf(parentRid);
    if (!parentStorage) return null;
    const fromCol = colName(parentStorage, r.fromField);
    if (!fromCol) return null; // FK không phải cột typed
    const parentAlias = aliasByRid[parentRid];
    const alias = aliasByRid[r.id]!;
    // toField: rỗng/"id" → khớp id; else cột typed trên target.
    let toRef: string;
    if (r.toField && r.toField !== "id") {
      const toCol = colName(childStorage, r.toField);
      if (!toCol) return null;
      toRef = `${alias}."${assertIdent(toCol)}"`;
    } else {
      toRef = `${alias}.id`;
    }
    const kw = r.joinKind === "inner" ? "INNER JOIN" : "LEFT JOIN";
    const childTbl = `"${assertIdent(childStorage.tableName)}"`;
    fromParts.push(
      sql`${sql.raw(`${kw} ${childTbl} ${alias} ON ${parentAlias}."${assertIdent(fromCol)}" = ${toRef} AND ${alias}.company_id`)} = ${companyId}::uuid AND ${sql.raw(`${alias}.deleted_at`)} IS NULL`,
    );
  }
  const fromSql = sql.join(fromParts, sql` `);

  // WHERE: base scope + filters (base source field + field-key) → cột.
  const whereParts: SQL[] = [sql`b.company_id = ${companyId}::uuid AND b.deleted_at IS NULL`];

  // baseFilters: key = tên field gốc trên base.
  for (const [field, cond] of Object.entries(cfg.baseFilters ?? {})) {
    const col = colName(baseStorage, field);
    if (!col) return null;
    const frag = filterFrag(sql.raw(`b."${assertIdent(col)}"`), cond.op, cond.value);
    if (!frag) return null;
    whereParts.push(frag);
  }
  // query.filters: key = field.key chiếu.
  const fieldByKey = new Map(cfg.fields.map((f) => [f.key, f]));
  for (const [key, cond] of Object.entries(query.filters ?? {})) {
    const f = fieldByKey.get(key);
    if (!f) return null;
    const st = storageOf(f.sourceRelationId);
    if (!st) return null;
    const col = colName(st, f.sourceField);
    if (!col) return null;
    const expr = sql.raw(`${aliasByRid[f.sourceRelationId]}."${assertIdent(col)}"`);
    const frag = filterFrag(expr, cond.op, cond.value);
    if (!frag) return null;
    whereParts.push(frag);
  }
  const whereSql = sql.join(whereParts, sql` AND `);

  // ORDER BY: sort key → cột.
  let orderSql = sql``;
  const sortKey = query.sort?.key ?? cfg.sort?.key;
  const sortDir = query.sort?.dir ?? cfg.sort?.dir ?? "asc";
  if (sortKey) {
    const f = fieldByKey.get(sortKey);
    if (!f) return null;
    const st = storageOf(f.sourceRelationId);
    const col = st ? colName(st, f.sourceField) : null;
    if (!col) return null;
    orderSql = sql` ORDER BY ${sql.raw(`${aliasByRid[f.sourceRelationId]}."${assertIdent(col)}" ${sortDir === "desc" ? "DESC" : "ASC"}`)}`;
  }

  // SELECT projection: b.id AS __id + mỗi field (cột hoặc ext->>).
  const selectParts: SQL[] = [sql.raw(`b.id AS "__id"`)];
  for (const f of cfg.fields) {
    const alias = aliasByRid[f.sourceRelationId];
    if (alias == null) return null;
    const st = storageOf(f.sourceRelationId);
    const col = st ? colName(st, f.sourceField) : null;
    const expr = col
      ? `${alias}."${assertIdent(col)}"`
      : `${alias}.ext->>'${f.sourceField.replace(/'/g, "''")}'`;
    selectParts.push(sql.raw(`${expr} AS "${assertIdent(f.key)}"`));
  }
  const selectSql = sql.join(selectParts, sql`, `);

  const limit = query.limit ?? cfg.defaultLimit ?? 100;
  const offset = query.offset ?? 0;
  const rowsSql = sql`SELECT ${selectSql} FROM ${fromSql} WHERE ${whereSql}${orderSql} LIMIT ${limit} OFFSET ${offset}`;
  const countSql = sql`SELECT count(*)::int AS count FROM ${fromSql} WHERE ${whereSql}`;
  return { rowsSql, countSql };
}

/** Mảnh điều kiện WHERE cho 1 toán tử. null = toán tử không hỗ trợ. */
function filterFrag(expr: SQL, op: string, value: unknown): SQL | null {
  switch (op) {
    case "=":
      return sql`${expr}::text = ${String(value)}`;
    case "!=":
      return sql`${expr}::text <> ${String(value)}`;
    case "contains":
      return sql`${expr}::text ILIKE ${`%${String(value)}%`}`;
    case ">":
      return sql`${expr}::numeric > ${Number(value)}`;
    case ">=":
      return sql`${expr}::numeric >= ${Number(value)}`;
    case "<":
      return sql`${expr}::numeric < ${Number(value)}`;
    case "<=":
      return sql`${expr}::numeric <= ${Number(value)}`;
    case "in": {
      const arr = Array.isArray(value) ? value.map(String) : [];
      return sql`${expr}::text = ANY(${arr})`;
    }
    default:
      return null;
  }
}

/**
 * Hậu xử lý 1 row phẳng (từ câu JOIN) → DataSourceRow: decrypt field encrypted,
 * strip field role không đọc được, eval computed. fieldsByEntity: entityId →
 * EntityFieldDef[] của node đó (để biết encrypted + RBAC).
 */
export function projectJoinRow(
  cfg: DataSourceConfig,
  flat: Record<string, unknown>,
  role: Role,
  entityByRid: Record<string, string>,
  fieldsByEntity: Record<string, EntityFieldDef[]>,
): DataSourceRow {
  const row: DataSourceRow = { id: flat.__id as string };
  for (const f of cfg.fields) {
    const eid = entityByRid[f.sourceRelationId];
    const fd = eid ? fieldsByEntity[eid]?.find((x) => x.name === f.sourceField) : undefined;
    if (fd && !fieldCan(role, "read", fd)) continue; // RBAC strip
    let v = flat[f.key];
    if (fd?.encrypted) v = decryptField(v);
    row[f.key] = v ?? null;
  }
  for (const c of cfg.computed ?? []) {
    const r = evaluate(c.expr, row as Record<string, unknown>);
    row[c.key] = r.ok ? (r.value ?? null) : null;
  }
  return row;
}

/** Map rid → entityId cho 1 config (cho projectJoinRow). */
export function entityByRidOf(cfg: DataSourceConfig): Record<string, string> {
  const m: Record<string, string> = { base: cfg.baseEntityId };
  for (const r of cfg.relations) m[r.id] = r.targetEntityId;
  return m;
}
