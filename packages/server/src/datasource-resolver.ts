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

import type {
  DataSourceConfig,
  DataSourceField,
  DataSourceRelation,
  DataSourceRow,
  EntityFieldDef,
  FilterOp,
  Role,
} from "@erp-framework/core";
import { entityRecords } from "@erp-framework/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "./db";
import {
  buildRecordWhere,
  decryptDataOut,
  loadEntityFields,
  stripUnreadableFields,
} from "./router-helpers";

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

function asId(v: unknown): string | null {
  if (typeof v === "string") return v || null;
  return v != null ? String(v) : null;
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
    const idByRow = nodes.map((nd) => {
      const from = rel.fromRelationId == null ? nd.base : nd[rel.fromRelationId];
      return from ? asId(from[rel.fromField]) : null;
    });
    const distinct = [...new Set(idByRow.filter((x): x is string => !!x))];
    const recMap = new Map<string, Record<string, unknown>>();
    if (distinct.length > 0) {
      const recs = await db
        .select()
        .from(entityRecords)
        .where(
          and(
            eq(entityRecords.companyId, companyId),
            eq(entityRecords.entityId, rel.targetEntityId),
            inArray(entityRecords.id, distinct),
            sql`${entityRecords.deletedAt} IS NULL`,
          ),
        );
      for (const rec of recs) {
        recMap.set(
          rec.id as string,
          stripUnreadableFields(
            targetFields,
            decryptDataOut(targetFields, rec.data as Record<string, unknown>),
            role,
          ),
        );
      }
    }
    nodes.forEach((nd, i) => {
      const tid = idByRow[i]!;
      nd[rel.id] = tid ? (recMap.get(tid) ?? null) : null;
      ids[i]![rel.id] = tid;
    });
  }

  // inner join: bỏ row thiếu record liên quan
  let keep = baseRows.map((_, i) => i);
  for (const rel of cfg.relations) {
    if (rel.joinKind === "inner") keep = keep.filter((i) => nodes[i]![rel.id] != null);
  }

  const projection = cfg.fields.length > 0 ? cfg.fields : autoBaseFields(baseFields);
  return keep.map((i) => {
    const row: DataSourceRow = { id: baseRows[i]!.id, __ids: ids[i] };
    for (const f of projection) {
      const nd = f.sourceRelationId === "base" ? nodes[i]!.base : nodes[i]![f.sourceRelationId];
      row[f.key] = nd ? (nd[f.sourceField] ?? null) : null;
    }
    return row;
  });
}

export async function resolveList(
  db: DB,
  companyId: string,
  role: Role,
  cfg: DataSourceConfig,
  query: ResolveQuery,
): Promise<{ rows: DataSourceRow[]; total: number }> {
  if (!cfg.baseEntityId) return { rows: [], total: 0 };

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
  const where = buildRecordWhere(
    companyId,
    cfg.baseEntityId,
    { filters: baseFilters, q: query.q },
    false,
  );
  let q = db.select().from(entityRecords).where(where).$dynamic();
  if (baseSort) {
    const dir = baseSort.dir === "desc" ? sql`desc` : sql`asc`;
    q = q.orderBy(sql`(${entityRecords.data}->>${baseSort.field}) ${dir}`);
  }
  const limit = query.limit ?? cfg.defaultLimit ?? 100;
  const offset = query.offset ?? 0;
  const baseRows = (await q.limit(limit).offset(offset)) as unknown as BaseRow[];
  const [cnt] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(entityRecords)
    .where(where);
  const total = cnt?.count ?? 0;

  let rows = await stitchAndProject(db, companyId, role, cfg, baseRows, baseFields);

  // Post-stitch (giới hạn v1: trên trang đã limit)
  for (const pf of postFilters) rows = rows.filter((r) => matchOp(r[pf.key], pf.op, pf.value));
  if (sortField && sortField.sourceRelationId !== "base") {
    const mul = sortDir === "desc" ? -1 : 1;
    rows.sort((a, b) => cmp(a[sortField.key], b[sortField.key]) * mul);
  }

  return { rows, total };
}

/** Field phẳng đã chiếu (cho widget render). cfg.fields nếu có, else auto base. */
export async function resolveFields(
  db: DB,
  companyId: string,
  cfg: DataSourceConfig,
): Promise<DataSourceField[]> {
  if (cfg.fields.length > 0) return cfg.fields;
  if (!cfg.baseEntityId) return [];
  return autoBaseFields(await loadEntityFields(db, companyId, cfg.baseEntityId));
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
  const baseRows = (await db
    .select()
    .from(entityRecords)
    .where(
      and(
        eq(entityRecords.companyId, companyId),
        eq(entityRecords.entityId, cfg.baseEntityId),
        eq(entityRecords.id, baseId),
        sql`${entityRecords.deletedAt} IS NULL`,
      ),
    )) as unknown as BaseRow[];
  if (baseRows.length === 0) return null;
  const rows = await stitchAndProject(db, companyId, role, cfg, baseRows, baseFields);
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
