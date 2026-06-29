/* ==========================================================
   datasource-resolver.ts — Join engine + write-mapping cho
   "Nguồn dữ liệu" (DataSource). Batch-stitching ở tầng app:
   - query base entity (buildRecordWhere + filter/sort/limit base-only),
   - mỗi relation 1 query `id = ANY(...)` (KHÔNG N+1), stitch theo cây,
   - chiếu (project) sang row phẳng theo cfg.fields.
   Tái dùng buildRecordWhere/loadEntityFields/decryptDataOut/
   stripUnreadableFields — KHÔNG raw SQL self-join (field RBAC/decrypt/
   rollup đều là JS; encrypted field không join/filter SQL được).

   Ghi: base entity là gốc (aggregate-root). Hàm splitWriteData phân vùng
   key theo node + ánh xạ alias→tên field thật; router gọi records caller
   để thực thi (giữ nguyên side-effect: sequence/validate/webhook/audit).

   Giới hạn v1: filter/sort trên field JOIN là best-effort SAU stitch trên
   trang đã limit (server-side chỉ lọc/sort field base).
   ========================================================== */

import {
  type DataSourceConfig,
  type DataSourceField,
  type DataSourceRelation,
  type DataSourceRow,
  type EntityFieldDef,
  evaluate,
  type FilterOp,
  type Role,
} from "@erp-framework/core";
import { entities } from "@erp-framework/db";
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "./db";
import {
  entityByRidOf,
  projectJoinRow,
  type StorageByEntity,
  tryBuildJoinQuery,
} from "./datasource-sql-join";
import { getRecordStore, isHybridTablesEnabled } from "./record-store";
import { decryptDataOut, loadEntityFields, stripUnreadableFields } from "./router-helpers";

type Cond = { op: FilterOp; value: unknown };
type FilterMap = Record<string, Cond>;

export interface ResolveQuery {
  limit?: number;
  offset?: number;
  filters?: FilterMap;
  sort?: { key: string; dir: "asc" | "desc" };
  q?: string;
}

/* ─── Helpers ─────────────────────────────────────────────── */

/** Field tự chiếu khi cfg.fields rỗng — toàn bộ field base, writable. */
function autoBaseFields(baseFields: EntityFieldDef[]): DataSourceField[] {
  return baseFields.map((f) => ({
    key: f.name,
    sourceRelationId: "base" as const,
    sourceField: f.name,
    label: f.label,
    type: f.type,
    writable: true,
  }));
}

/** Sắp relations sao cho cha (fromRelationId) đứng trước con (topological). */
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
    if (!moved) break; // cycle / parent thiếu → dừng, phần còn lại append
  }
  return out.concat(pending);
}

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v);
}

/** Khớp 1 điều kiện trên giá trị (post-stitch, field join). */
function matchOp(val: unknown, op: FilterOp, target: unknown): boolean {
  switch (op) {
    case "=":
      return String(val ?? "") === String(target ?? "");
    case "!=":
      return String(val ?? "") !== String(target ?? "");
    case "contains":
      return String(val ?? "")
        .toLowerCase()
        .includes(String(target ?? "").toLowerCase());
    case ">":
      return num(val) > num(target);
    case ">=":
      return num(val) >= num(target);
    case "<":
      return num(val) < num(target);
    case "<=":
      return num(val) <= num(target);
    case "in": {
      const arr = Array.isArray(target)
        ? target.map(String)
        : String(target ?? "")
            .split(",")
            .map((s) => s.trim());
      return arr.includes(String(val ?? ""));
    }
    case "is-not-true":
      // NULL-safe: null/undefined/'false'/false đều khớp
      return val !== true && val !== "true";
    case "is-true":
      return val === true || val === "true";
    case "between": {
      const arr = Array.isArray(target) ? target : [];
      const s = String(val ?? "");
      if (arr[0] != null && arr[0] !== "" && s < String(arr[0])) return false;
      if (arr[1] != null && arr[1] !== "" && s > String(arr[1])) return false;
      return true;
    }
    default:
      return true;
  }
}

function cmp(a: unknown, b: unknown): number {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

/* ─── Đọc (join) ──────────────────────────────────────────── */

interface BaseRow {
  id: string;
  data: Record<string, unknown>;
}

/** Stitch + project base rows đã tải sẵn → row phẳng. Dùng cho cả list/get. */
async function stitchAndProject(
  db: DB,
  companyId: string,
  role: Role,
  cfg: DataSourceConfig,
  baseRows: BaseRow[],
  baseFields: EntityFieldDef[],
): Promise<DataSourceRow[]> {
  const store = getRecordStore(db);
  // node data + target id theo từng base row
  const nodes: Record<string, Record<string, unknown> | null>[] = baseRows.map((r) => ({
    base: stripUnreadableFields(baseFields, decryptDataOut(baseFields, r.data), role),
  }));
  const ids: Record<string, string | null>[] = baseRows.map(() => ({}));

  const fieldCache = new Map<string, EntityFieldDef[]>();
  for (const rel of orderRelations(cfg.relations)) {
    let targetFields = fieldCache.get(rel.targetEntityId);
    if (!targetFields) {
      targetFields = await loadEntityFields(db, companyId, rel.targetEntityId);
      fieldCache.set(rel.targetEntityId, targetFields);
    }
    // toField rỗng/"id" = khớp theo record id (lookup); khác = join cột↔cột.
    const toField = rel.toField && rel.toField !== "id" ? rel.toField : null;

    // Giá trị khoá nối lấy từ node "from" (đã decrypt) theo fromField.
    const keyByRow = nodes.map((nd) => {
      const from = rel.fromRelationId == null ? nd.base : nd[rel.fromRelationId];
      if (!from) return null;
      const v = from[rel.fromField];
      return v == null || v === "" ? null : String(v);
    });
    const distinct = [...new Set(keyByRow.filter((x): x is string => x != null))];

    // Map khoá → { id record thật, data đã decrypt+strip }. First-match wins.
    const entryMap = new Map<string, { id: string; data: Record<string, unknown> }>();
    if (distinct.length > 0) {
      // findByKeyIn: toField null → khớp id::text (lookup cổ điển); else data->>toField.
      // (Store xử lý cast id::text → không throw khi giá trị là mã nghiệp vụ.)
      const recs = await store.findByKeyIn(companyId, rel.targetEntityId, toField, distinct);
      for (const rec of recs) {
        const data = rec.data as Record<string, unknown>;
        const key = toField
          ? data[toField] == null
            ? null
            : String(data[toField])
          : (rec.id as string);
        if (key == null || entryMap.has(key)) continue; // first-match wins
        entryMap.set(key, {
          id: rec.id as string,
          data: stripUnreadableFields(targetFields, decryptDataOut(targetFields, data), role),
        });
      }
    }
    nodes.forEach((nd, i) => {
      const key = keyByRow[i];
      const entry = key != null ? (entryMap.get(key) ?? null) : null;
      nd[rel.id] = entry?.data ?? null;
      // __ids giữ id record thật đã khớp → ghi ngược đúng record liên quan.
      ids[i]![rel.id] = entry?.id ?? null;
    });
  }

  // inner join: bỏ row thiếu record liên quan
  let keep = baseRows.map((_, i) => i);
  for (const rel of cfg.relations) {
    if (rel.joinKind === "inner") keep = keep.filter((i) => nodes[i]![rel.id] != null);
  }

  // ── Aggregate 1-N / N-N — batch (không N+1), tính cho MỌI base row ──
  const aggByRow: Record<string, unknown>[] = baseRows.map(() => ({}));
  for (const agg of cfg.aggregates ?? []) {
    const sourceRid = agg.sourceRelationId ?? "base";
    const matchField = agg.matchField ?? "id";
    const isCount = agg.agg === "count";

    // Giá trị khớp (FK ngược) của từng base row.
    const matchByRow: Array<string | null> = baseRows.map((br, i) => {
      if (matchField === "id") {
        const id = sourceRid === "base" ? br.id : ids[i]![sourceRid];
        return id != null ? String(id) : null;
      }
      const nd = sourceRid === "base" ? nodes[i]!.base : nodes[i]![sourceRid];
      const v = nd ? nd[matchField] : null;
      return v == null || v === "" ? null : String(v);
    });
    const distinct = [...new Set(matchByRow.filter((x): x is string => x != null))];
    if (distinct.length === 0) {
      baseRows.forEach((_, i) => {
        aggByRow[i]![agg.key] = isCount ? 0 : null;
      });
      continue;
    }

    // Bảng "nhiều": entity con (1-N) hoặc bảng nối (N-N).
    let targetFields = fieldCache.get(agg.targetEntityId);
    if (!targetFields) {
      targetFields = await loadEntityFields(db, companyId, agg.targetEntityId);
      fieldCache.set(agg.targetEntityId, targetFields);
    }
    const targetRecs = (await store.findByKeyIn(
      companyId,
      agg.targetEntityId,
      agg.targetField,
      distinct,
    )) as Array<{ id: string; data: Record<string, unknown> }>;

    // N-N: nạp record far (entity thật) để đọc valueField — trừ count.
    let farMap: Map<string, Record<string, unknown>> | null = null;
    const via = agg.via;
    if (via && !isCount && agg.valueField) {
      const farKey = via.farKeyField && via.farKeyField !== "id" ? via.farKeyField : null;
      const farIds = [
        ...new Set(
          targetRecs
            .map((r) => r.data[via.farField])
            .filter((v) => v != null && v !== "")
            .map(String),
        ),
      ];
      let farFields = fieldCache.get(via.farEntityId);
      if (!farFields) {
        farFields = await loadEntityFields(db, companyId, via.farEntityId);
        fieldCache.set(via.farEntityId, farFields);
      }
      farMap = new Map();
      if (farIds.length > 0) {
        const farRecs = (await store.findByKeyIn(
          companyId,
          via.farEntityId,
          farKey,
          farIds,
        )) as Array<{ id: string; data: Record<string, unknown> }>;
        for (const fr of farRecs) {
          const k = farKey ? String(fr.data[farKey] ?? "") : String(fr.id);
          if (k && !farMap.has(k)) {
            farMap.set(
              k,
              stripUnreadableFields(farFields, decryptDataOut(farFields, fr.data), role),
            );
          }
        }
      }
    }

    // Gom theo giá trị khớp.
    const acc = new Map<string, { count: number; values: number[] }>();
    for (const rec of targetRecs) {
      const mv = rec.data[agg.targetField];
      if (mv == null) continue;
      const key = String(mv);
      let a = acc.get(key);
      if (!a) {
        a = { count: 0, values: [] };
        acc.set(key, a);
      }
      a.count++;
      if (!isCount && agg.valueField) {
        let host: Record<string, unknown> | undefined;
        if (via && farMap) {
          const farId = rec.data[via.farField];
          host = farId != null ? farMap.get(String(farId)) : undefined;
        } else {
          host = stripUnreadableFields(targetFields, decryptDataOut(targetFields, rec.data), role);
        }
        const n = Number(host ? host[agg.valueField] : undefined);
        if (Number.isFinite(n)) a.values.push(n);
      }
    }

    const reduceAgg = (a: { count: number; values: number[] } | undefined): number | null => {
      if (!a) return isCount ? 0 : null;
      const sum = a.values.reduce((s, x) => s + x, 0);
      switch (agg.agg) {
        case "count":
          return a.count;
        case "sum":
          return sum;
        case "avg":
          return a.values.length ? sum / a.values.length : null;
        case "min":
          return a.values.length ? Math.min(...a.values) : null;
        case "max":
          return a.values.length ? Math.max(...a.values) : null;
        default:
          return null;
      }
    };
    baseRows.forEach((_, i) => {
      const mv = matchByRow[i];
      aggByRow[i]![agg.key] = mv != null ? reduceAgg(acc.get(mv)) : isCount ? 0 : null;
    });
  }

  const projection = cfg.fields.length > 0 ? cfg.fields : autoBaseFields(baseFields);
  return keep.map((i) => {
    const row: DataSourceRow = { id: baseRows[i]!.id, __ids: ids[i] };
    for (const f of projection) {
      const nd = f.sourceRelationId === "base" ? nodes[i]!.base : nodes[i]![f.sourceRelationId];
      row[f.key] = nd ? (nd[f.sourceField] ?? null) : null;
    }
    for (const [k, v] of Object.entries(aggByRow[i]!)) row[k] = v;
    // Cột tính toán: eval theo thứ tự (cột sau ref được cột trước), fail-safe null.
    for (const c of cfg.computed ?? []) {
      const r = evaluate(c.expr, row as Record<string, unknown>);
      row[c.key] = r.ok ? (r.value ?? null) : null;
    }
    // Id hệ thống PHẢI thắng — field chiếu trùng key "id" (cột nguồn tên 'id')
    // không được ghi đè record id (write-back cần đúng id để validate UUID).
    row.id = baseRows[i]!.id;
    return row;
  });
}

/**
 * Phase 3 — nhánh JOIN SQL thật khi base + mọi relation đều tier='table'.
 * Trả null nếu không đủ điều kiện (caller dùng batch-stitch). Postgres lo
 * join/filter/sort/paginate → filter/sort field JOIN đúng trên TOÀN tập (gỡ
 * giới hạn v1). Decrypt/RBAC-strip/computed làm ở JS sau fetch.
 */
async function tryJoinResolveList(
  db: DB,
  companyId: string,
  role: Role,
  cfg: DataSourceConfig,
  query: ResolveQuery,
): Promise<{ rows: DataSourceRow[]; total: number } | null> {
  const eids = [...new Set([cfg.baseEntityId, ...cfg.relations.map((r) => r.targetEntityId)])];
  const rows = await db
    .select({ id: entities.id, fields: entities.fields, meta: entities.meta })
    .from(entities)
    .where(and(eq(entities.companyId, companyId), inArray(entities.id, eids)));
  const storages: StorageByEntity = {};
  const fieldsByEntity: Record<string, EntityFieldDef[]> = {};
  for (const r of rows) {
    const storage = (r.meta as { storage?: { tier?: string } } | null)?.storage;
    storages[r.id] = storage?.tier === "table" ? (storage as StorageByEntity[string]) : null;
    fieldsByEntity[r.id] = (r.fields ?? []) as EntityFieldDef[];
  }
  const built = tryBuildJoinQuery(cfg, storages, companyId, {
    filters: query.filters,
    q: query.q,
    sort: query.sort,
    limit: query.limit ?? cfg.defaultLimit ?? 100,
    offset: query.offset ?? 0,
  });
  if (!built) return null;
  const ebr = entityByRidOf(cfg);
  const flat = (await db.execute(built.rowsSql)) as unknown as Record<string, unknown>[];
  const out = flat.map((fr) => projectJoinRow(cfg, fr, role, ebr, fieldsByEntity));
  // Cột tính toán (formula): nhánh JOIN SQL cũng phải eval như batch-stitch —
  // nếu không, cột computed RỖNG khi base+relation đều tier='table'. Eval sau
  // khi project (ref được cột phẳng đã chiếu), theo thứ tự, fail-safe null.
  if (cfg.computed?.length) {
    for (const row of out) {
      const r = row as Record<string, unknown>;
      for (const c of cfg.computed) {
        const ev = evaluate(c.expr, r);
        r[c.key] = ev.ok ? (ev.value ?? null) : null;
      }
    }
  }
  const counted = (await db.execute(built.countSql)) as unknown as Array<{ count: number }>;
  return { rows: out, total: Number(counted[0]?.count ?? 0) };
}

export async function resolveList(
  db: DB,
  companyId: string,
  role: Role,
  cfg: DataSourceConfig,
  query: ResolveQuery,
): Promise<{ rows: DataSourceRow[]; total: number }> {
  if (!cfg.baseEntityId) return { rows: [], total: 0 };

  // Phase 3: ưu tiên JOIN SQL thật (chỉ khi HYBRID bật + đủ điều kiện).
  if (isHybridTablesEnabled()) {
    const joined = await tryJoinResolveList(db, companyId, role, cfg, query);
    if (joined) return joined;
  }

  const fieldByKey = new Map(cfg.fields.map((f) => [f.key, f]));

  // Tách filter: field base → server-side; field join → post-stitch.
  const baseFilters: FilterMap = { ...(cfg.baseFilters ?? {}) };
  const postFilters: Array<{ key: string; op: FilterOp; value: unknown }> = [];
  for (const [key, cond] of Object.entries(query.filters ?? {})) {
    const f = fieldByKey.get(key);
    if (f && f.sourceRelationId === "base") baseFilters[f.sourceField] = cond;
    else postFilters.push({ key, op: cond.op, value: cond.value });
  }

  // Sort: chỉ đẩy server-side nếu sort key trỏ field base.
  const sortKey = query.sort?.key ?? cfg.sort?.key;
  const sortDir = query.sort?.dir ?? cfg.sort?.dir ?? "asc";
  const sortField = sortKey ? fieldByKey.get(sortKey) : undefined;
  const baseSort =
    sortField && sortField.sourceRelationId === "base"
      ? { field: sortField.sourceField, dir: sortDir }
      : undefined;

  const baseFields = await loadEntityFields(db, companyId, cfg.baseEntityId);
  const limit = query.limit ?? cfg.defaultLimit ?? 100;
  const offset = query.offset ?? 0;
  // Đọc base rows + total qua store (EAV: where data->>field; bảng thật: cột).
  const { rows: baseRows, total } = await getRecordStore(db).list(companyId, cfg.baseEntityId, {
    filters: baseFilters,
    q: query.q,
    sort: baseSort,
    limit,
    offset,
  });

  let rows = await stitchAndProject(
    db,
    companyId,
    role,
    cfg,
    baseRows as unknown as BaseRow[],
    baseFields,
  );

  // Post-stitch (giới hạn v1: trên trang đã limit)
  for (const pf of postFilters) rows = rows.filter((r) => matchOp(r[pf.key], pf.op, pf.value));
  if (sortField && sortField.sourceRelationId !== "base") {
    const mul = sortDir === "desc" ? -1 : 1;
    rows.sort((a, b) => cmp(a[sortField.key], b[sortField.key]) * mul);
  }

  return { rows, total };
}

/** Field phẳng đã chiếu (cho widget render). cfg.fields nếu có, else auto base,
 *  + cột aggregate (read-only, type number). KHÔNG vào write path (splitWriteData
 *  chỉ đọc cfg.fields). */
export async function resolveFields(
  db: DB,
  companyId: string,
  cfg: DataSourceConfig,
): Promise<DataSourceField[]> {
  const baseRaw =
    cfg.fields.length > 0
      ? cfg.fields
      : cfg.baseEntityId
        ? autoBaseFields(await loadEntityFields(db, companyId, cfg.baseEntityId))
        : [];
  // Suy ref cho field khóa-tham-chiếu: relation có fromRelationId=null (gốc base)
  // + fromField === field.sourceField → field đó trỏ tới relation.targetEntityId.
  // Cho UI dựng lookup chọn bản ghi entity đích (đầy đủ) thay vì gõ id thô.
  const refByLocalField = new Map<string, string>();
  for (const rel of cfg.relations ?? []) {
    if (rel.fromRelationId == null && rel.fromField) {
      refByLocalField.set(rel.fromField, rel.targetEntityId);
    }
  }
  const base = baseRaw.map((f) =>
    f.sourceRelationId === "base" && !f.ref && refByLocalField.has(f.sourceField)
      ? { ...f, ref: refByLocalField.get(f.sourceField) }
      : f,
  );
  const aggFields: DataSourceField[] = (cfg.aggregates ?? []).map((a) => ({
    key: a.key,
    sourceRelationId: "base",
    sourceField: a.key,
    label: a.label,
    type: "number",
    writable: false,
  }));
  const computedFields: DataSourceField[] = (cfg.computed ?? []).map((c) => ({
    key: c.key,
    sourceRelationId: "base",
    sourceField: c.key,
    label: c.label,
    type: c.type || "text",
    writable: false,
  }));
  return [...base, ...aggFields, ...computedFields];
}

export async function resolveGet(
  db: DB,
  companyId: string,
  role: Role,
  cfg: DataSourceConfig,
  baseId: string,
): Promise<DataSourceRow | null> {
  if (!cfg.baseEntityId) return null;
  const baseFields = await loadEntityFields(db, companyId, cfg.baseEntityId);
  const baseRow = await getRecordStore(db).getActiveById(companyId, cfg.baseEntityId, baseId);
  if (!baseRow) return null;
  const rows = await stitchAndProject(
    db,
    companyId,
    role,
    cfg,
    [baseRow] as unknown as BaseRow[],
    baseFields,
  );
  return rows[0] ?? null;
}

/* ─── Ghi (mapping) ───────────────────────────────────────── */

export interface WriteSplit {
  /** Field base: tên field thật → giá trị. */
  base: Record<string, unknown>;
  /** relationId → { tên field thật → giá trị } (chỉ field writable). */
  joins: Record<string, Record<string, unknown>>;
}

/** Ánh xạ flat data (theo key) → tên field thật, phân vùng base/join.
 *  Chỉ nhận key có trong projection; join field chỉ nhận khi writable. */
export function splitWriteData(cfg: DataSourceConfig, flat: Record<string, unknown>): WriteSplit {
  const baseAuto = cfg.fields.length === 0;
  const byKey = new Map(cfg.fields.map((f) => [f.key, f]));
  const out: WriteSplit = { base: {}, joins: {} };
  for (const [key, val] of Object.entries(flat)) {
    if (key === "id" || key === "__ids") continue;
    const f = byKey.get(key);
    if (!f) {
      // projection rỗng → coi mọi key là field base (auto-project).
      if (baseAuto) out.base[key] = val;
      continue;
    }
    if (f.sourceRelationId === "base") {
      out.base[f.sourceField] = val;
    } else if (f.writable === true) {
      (out.joins[f.sourceRelationId] ??= {})[f.sourceField] = val;
    }
    // join field không writable → bỏ qua.
  }
  return out;
}
