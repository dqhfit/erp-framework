/* ==========================================================
   record-store.ts — Tầng trừu tượng truy cập VẬT LÝ record động.

   Mục tiêu (xem kế hoạch HYBRID storage): tách "cách lưu record" khỏi
   "nghiệp vụ quanh record" (validate, encrypt, RBAC strip, webhook,
   audit, rollup, workflow trigger). Mọi đọc/ghi record của MỘT entity
   đi qua interface `RecordStore`:
     - chuẩn hoá row về hợp đồng `entityRecords.$inferSelect` (cột `data`
       là object phẳng) → code tiêu thụ phía trên KHÔNG đổi;
     - là điểm DUY NHẤT biết record nằm ở đâu (EAV `entity_records` hôm
       nay; bảng thật `er_<id>` ở Phase 1).

   Phase 0: chỉ có `EavRecordStore` — bọc đúng các câu Drizzle hiện hành
   trên `entity_records`, KHÔNG đổi hành vi. `getRecordStore(db)` luôn trả
   EAV. Phase 1 sẽ biến factory thành dispatcher per-entity (đọc
   `entities.meta.storage.tier`) + locator cho thao tác chỉ-có-recordId.

   LƯU Ý: các thao tác CROSS-ENTITY (scanBackRefs/applyCascadeOnDelete/
   cây cha-con CTE, assertUnique quét, duplicate-detection) HIỆN còn đọc
   thẳng `entity_records` ở router-helpers/records-router — đúng khi mọi
   entity đều EAV. Chúng được đánh dấu TODO(hybrid) để chuyển sang
   store-aware ở Phase 4.
   ========================================================== */

import type { FilterOp } from "@erp-framework/core";
import { entities, entityRecords, recordLocator } from "@erp-framework/db";
import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { DB } from "./db";
import { assertIdent, coerceColumnValue, type EntityStorage } from "./entity-table-ddl";
import { buildRecordWhere } from "./router-helpers";

/** Row record chuẩn hoá — đúng shape select của `entity_records`. */
export type StoredRecord = typeof entityRecords.$inferSelect;

/** State tối thiểu để update/bulk check version + tính diff. */
export type RecordState = Pick<StoredRecord, "entityId" | "data" | "version" | "deletedAt">;

export interface RecordListParams {
  /** Lọc theo field (base) — op + value. */
  filters?: Record<string, { op: FilterOp; value: unknown }>;
  /** Full-text search (search_tsv). */
  q?: string;
  /** Sort theo field base. */
  sort?: { field: string; dir: "asc" | "desc" };
  limit?: number;
  offset?: number;
  /** Gồm cả record soft-deleted. Default false. */
  includeDeleted?: boolean;
  /** Tính `total` (count). Default true; export tắt để khỏi query thừa. */
  withTotal?: boolean;
}

/** Hàm tổng hợp 1 cột (footer kiểu DevExpress) — tính SERVER-SIDE trên TẬP đã
 *  lọc (toàn bảng, không chỉ trang). count = count(*); còn lại bỏ qua giá trị
 *  không-số (regex guard) để khỏi lỗi cast. */
export interface AggregateSpec {
  field: string;
  fn: "sum" | "avg" | "count" | "min" | "max";
}
export interface AggregateParams {
  filters?: Record<string, { op: FilterOp; value: unknown }>;
  q?: string;
  includeDeleted?: boolean;
  aggregates: AggregateSpec[];
}

/**
 * Hợp đồng truy cập vật lý record của một entity. Mọi method nhận id
 * tường minh (companyId/entityId/recordId) → một instance phục vụ mọi
 * entity (Phase 1 dispatch nội bộ theo entity).
 */
export interface RecordStore {
  /** List + (tùy chọn) total cho một entity. Lọc/sort/paginate field base. */
  list(
    companyId: string,
    entityId: string,
    params?: RecordListParams,
  ): Promise<{ rows: StoredRecord[]; total: number }>;

  /** Tổng hợp các cột (sum/avg/count/min/max) trên TẬP đã lọc (toàn bảng).
   *  Trả map field→giá trị (null→0). Cho footer summary của lưới server-paged. */
  aggregate(
    companyId: string,
    entityId: string,
    params: AggregateParams,
  ): Promise<Record<string, number>>;

  /** 1 record theo id (company-scoped) — GỒM cả soft-deleted (cho trang chi tiết). */
  getById(companyId: string, recordId: string): Promise<StoredRecord | null>;

  /** 1 record active theo (entity, id) — deleted_at IS NULL. */
  getActiveById(
    companyId: string,
    entityId: string,
    recordId: string,
  ): Promise<StoredRecord | null>;

  /** Record active của entity có khoá khớp: field=null → khớp id::text; else data->>field. */
  findByKeyIn(
    companyId: string,
    entityId: string,
    field: string | null,
    values: string[],
  ): Promise<StoredRecord[]>;

  /** State hiện tại (entityId,data,version,deletedAt) để check version/diff. */
  loadState(
    companyId: string,
    recordId: string,
    entityId?: string,
  ): Promise<RecordState | undefined>;

  /** Insert (data đã validate + encrypt bởi caller). */
  insert(
    companyId: string,
    entityId: string,
    data: Record<string, unknown>,
    createdBy: string | null,
  ): Promise<StoredRecord | undefined>;

  /** Shallow-merge patch vào data, set version mới (caller đã +1). */
  merge(
    companyId: string,
    recordId: string,
    patch: Record<string, unknown>,
    version: number,
  ): Promise<StoredRecord | undefined>;

  /** Thay TOÀN BỘ data (revert), set version mới. */
  replace(
    companyId: string,
    recordId: string,
    data: Record<string, unknown>,
    version: number,
  ): Promise<StoredRecord | undefined>;

  softDelete(companyId: string, recordId: string): Promise<void>;
  restore(companyId: string, recordId: string): Promise<void>;
  hardDelete(companyId: string, recordId: string): Promise<void>;

  /** Có record active nào (khác excludeRecordId) mang field=value? (unique check). */
  existsWithFieldValue(
    companyId: string,
    entityId: string,
    field: string,
    value: string,
    excludeRecordId?: string,
  ): Promise<boolean>;
}

/** Biểu thức SQL tổng hợp 1 cột từ expr-text của field (typed col hoặc jsonb).
 *  Bỏ qua giá trị không-số (regex guard) để khỏi lỗi cast; count = count(*). */
function aggExpr(fn: AggregateSpec["fn"], textExpr: SQL): SQL<number | null> {
  if (fn === "count") return sql<number>`count(*)::float8`;
  const num = sql`CASE WHEN btrim(${textExpr}) ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN btrim(${textExpr})::numeric ELSE NULL END`;
  const agg =
    fn === "sum"
      ? sql`sum(${num})`
      : fn === "avg"
        ? sql`avg(${num})`
        : fn === "min"
          ? sql`min(${num})`
          : sql`max(${num})`;
  return sql<number | null>`(${agg})::float8`;
}
/** Map kết quả 1 row (a0,a1,…) về field→giá trị số (null→0). */
function mapAggOut(
  specs: AggregateSpec[],
  row: Record<string, unknown> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  specs.forEach((a, i) => {
    out[a.field] = Number(row?.[`a${i}`] ?? 0) || 0;
  });
  return out;
}

/* ─── EAV impl — bọc câu Drizzle hiện hành trên entity_records ─── */

class EavRecordStore implements RecordStore {
  constructor(private readonly db: DB) {}

  async list(
    companyId: string,
    entityId: string,
    params: RecordListParams = {},
  ): Promise<{ rows: StoredRecord[]; total: number }> {
    const where = buildRecordWhere(
      companyId,
      entityId,
      { filters: params.filters, q: params.q },
      params.includeDeleted ?? false,
    );
    let q = this.db.select().from(entityRecords).where(where).$dynamic();
    if (params.sort) {
      const dir = params.sort.dir === "desc" ? sql`desc` : sql`asc`;
      q = q.orderBy(sql`(${entityRecords.data}->>${params.sort.field}) ${dir}`);
    }
    const rows = (await q.limit(params.limit ?? 100).offset(params.offset ?? 0)) as StoredRecord[];
    if (params.withTotal === false) return { rows, total: rows.length };
    const [c] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(entityRecords)
      .where(where);
    return { rows, total: c?.count ?? 0 };
  }

  async aggregate(
    companyId: string,
    entityId: string,
    params: AggregateParams,
  ): Promise<Record<string, number>> {
    const where = buildRecordWhere(
      companyId,
      entityId,
      { filters: params.filters, q: params.q },
      params.includeDeleted ?? false,
    );
    const sel: Record<string, SQL<number | null>> = {};
    params.aggregates.forEach((a, i) => {
      sel[`a${i}`] = aggExpr(a.fn, sql`(${entityRecords.data}->>${a.field})`);
    });
    if (Object.keys(sel).length === 0) return {};
    const [row] = await this.db.select(sel).from(entityRecords).where(where);
    return mapAggOut(params.aggregates, row as Record<string, unknown> | undefined);
  }

  async getById(companyId: string, recordId: string): Promise<StoredRecord | null> {
    const [row] = await this.db
      .select()
      .from(entityRecords)
      .where(and(eq(entityRecords.id, recordId), eq(entityRecords.companyId, companyId)));
    return row ?? null;
  }

  async getActiveById(
    companyId: string,
    entityId: string,
    recordId: string,
  ): Promise<StoredRecord | null> {
    const [row] = await this.db
      .select()
      .from(entityRecords)
      .where(
        and(
          eq(entityRecords.companyId, companyId),
          eq(entityRecords.entityId, entityId),
          eq(entityRecords.id, recordId),
          sql`${entityRecords.deletedAt} IS NULL`,
        ),
      );
    return row ?? null;
  }

  async findByKeyIn(
    companyId: string,
    entityId: string,
    field: string | null,
    values: string[],
  ): Promise<StoredRecord[]> {
    if (values.length === 0) return [];
    // Cast id sang text khi field=null: khớp lookup uuid + KHÔNG ném lỗi khi
    // join cột↔cột mà giá trị là mã nghiệp vụ (trả 0 match thay vì throw).
    const keyMatch = field
      ? inArray(sql`(${entityRecords.data} ->> ${field})`, values)
      : inArray(sql`(${entityRecords.id})::text`, values);
    return (await this.db
      .select()
      .from(entityRecords)
      .where(
        and(
          eq(entityRecords.companyId, companyId),
          eq(entityRecords.entityId, entityId),
          keyMatch,
          sql`${entityRecords.deletedAt} IS NULL`,
        ),
      )) as StoredRecord[];
  }

  async loadState(
    companyId: string,
    recordId: string,
    entityId?: string,
  ): Promise<RecordState | undefined> {
    const conds = [eq(entityRecords.id, recordId), eq(entityRecords.companyId, companyId)];
    if (entityId) conds.push(eq(entityRecords.entityId, entityId));
    const [row] = await this.db
      .select({
        entityId: entityRecords.entityId,
        data: entityRecords.data,
        version: entityRecords.version,
        deletedAt: entityRecords.deletedAt,
      })
      .from(entityRecords)
      .where(and(...conds));
    return row;
  }

  async insert(
    companyId: string,
    entityId: string,
    data: Record<string, unknown>,
    createdBy: string | null,
  ): Promise<StoredRecord | undefined> {
    const [row] = await this.db
      .insert(entityRecords)
      .values({ companyId, entityId, data, createdBy: createdBy ?? null })
      .returning();
    return row;
  }

  async merge(
    companyId: string,
    recordId: string,
    patch: Record<string, unknown>,
    version: number,
  ): Promise<StoredRecord | undefined> {
    const [row] = await this.db
      .update(entityRecords)
      .set({
        data: sql`${entityRecords.data} || ${JSON.stringify(patch)}::jsonb`,
        version,
        updatedAt: new Date(),
      })
      .where(and(eq(entityRecords.id, recordId), eq(entityRecords.companyId, companyId)))
      .returning();
    return row;
  }

  async replace(
    companyId: string,
    recordId: string,
    data: Record<string, unknown>,
    version: number,
  ): Promise<StoredRecord | undefined> {
    const [row] = await this.db
      .update(entityRecords)
      .set({ data, version, updatedAt: new Date() })
      .where(and(eq(entityRecords.id, recordId), eq(entityRecords.companyId, companyId)))
      .returning();
    return row;
  }

  async softDelete(companyId: string, recordId: string): Promise<void> {
    await this.db
      .update(entityRecords)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(entityRecords.id, recordId), eq(entityRecords.companyId, companyId)));
  }

  async restore(companyId: string, recordId: string): Promise<void> {
    await this.db
      .update(entityRecords)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(and(eq(entityRecords.id, recordId), eq(entityRecords.companyId, companyId)));
  }

  async hardDelete(companyId: string, recordId: string): Promise<void> {
    await this.db
      .delete(entityRecords)
      .where(and(eq(entityRecords.id, recordId), eq(entityRecords.companyId, companyId)));
  }

  async existsWithFieldValue(
    companyId: string,
    entityId: string,
    field: string,
    value: string,
    excludeRecordId?: string,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: entityRecords.id })
      .from(entityRecords)
      .where(
        and(
          eq(entityRecords.companyId, companyId),
          eq(entityRecords.entityId, entityId),
          sql`${entityRecords.deletedAt} IS NULL`,
          sql`${entityRecords.data}->>${field} = ${value}`,
          excludeRecordId ? sql`${entityRecords.id} <> ${excludeRecordId}::uuid` : sql`true`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}

/* ─── Table impl — bảng thật er_<id> (cột typed + ext jsonb) ───
   CHƯA verify runtime (cần Postgres). Chỉ chạy khi ERP_HYBRID_TABLES=1.
   Map data ↔ cột+ext theo storage.columns; cột không-map → ext. */

class TableRecordStore implements RecordStore {
  private readonly tbl: SQL;
  constructor(
    private readonly db: DB,
    private readonly entityId: string,
    private readonly storage: EntityStorage,
  ) {
    this.tbl = sql.raw(`"${assertIdent(storage.tableName)}"`);
  }

  /** Tách data → giá trị cột (đã coerce) + phần ext (field không-map). */
  private split(data: Record<string, unknown>): {
    cols: Array<{ col: string; value: unknown }>;
    ext: Record<string, unknown>;
  } {
    const cols: Array<{ col: string; value: unknown }> = [];
    const ext: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      const m = this.storage.columns[k];
      if (m) cols.push({ col: m.col, value: coerceColumnValue(m.pgType, v) });
      else ext[k] = v;
    }
    return { cols, ext };
  }

  /** Biểu thức (text) của field cho filter/sort/match: cột → "col"::text; else ext->>field. */
  private textExpr(field: string): SQL {
    const m = this.storage.columns[field];
    return m ? sql.raw(`"${assertIdent(m.col)}"::text`) : sql`ext->>${field}`;
  }

  /** Text dựng search_tsv = nối giá trị các field searchable (rỗng nếu không có). */
  private tsvText(data: Record<string, unknown>): string {
    return (this.storage.searchable ?? [])
      .map((f) => {
        const v = data[f];
        return v == null ? "" : String(v);
      })
      .filter(Boolean)
      .join(" ");
  }

  /** Ghép row bảng → StoredRecord (cột+ext → data; numeric về number;
   *  timestamp về Date — db.execute thô có thể trả chuỗi). */
  private toRecord(row: Record<string, unknown>): StoredRecord {
    const data: Record<string, unknown> = { ...((row.ext as Record<string, unknown>) ?? {}) };
    for (const [field, m] of Object.entries(this.storage.columns)) {
      const v = row[m.col];
      if (v == null) continue;
      data[field] = m.pgType === "numeric" ? Number(v) : v;
    }
    const toDate = (v: unknown): Date | null =>
      v == null ? null : v instanceof Date ? v : new Date(v as string);
    return {
      id: row.id as string,
      companyId: row.company_id as string,
      entityId: this.entityId,
      schemaVersion: "1",
      data,
      version: Number(row.version),
      deletedAt: toDate(row.deleted_at),
      searchTsv: (row.search_tsv as string | null) ?? null,
      rollupCache: (row.rollup_cache as unknown) ?? null,
      rollupInvalidated: Boolean(row.rollup_invalidated),
      createdBy: (row.created_by as string | null) ?? null,
      createdAt: toDate(row.created_at) as Date,
      updatedAt: toDate(row.updated_at) as Date,
    } as StoredRecord;
  }

  private async rows(query: SQL): Promise<Record<string, unknown>[]> {
    return (await this.db.execute(query)) as unknown as Record<string, unknown>[];
  }

  /** Dựng các điều kiện WHERE (company + soft-delete + filters + q). Dùng CHUNG
   *  cho list + aggregate để tập lọc khớp nhau. */
  private whereConds(
    companyId: string,
    params: { filters?: RecordListParams["filters"]; q?: string; includeDeleted?: boolean },
  ): SQL[] {
    const conds: SQL[] = [sql`company_id = ${companyId}::uuid`];
    if (!(params.includeDeleted ?? false)) conds.push(sql`deleted_at IS NULL`);
    for (const [field, cond] of Object.entries(params.filters ?? {})) {
      const e = this.textExpr(field);
      switch (cond.op) {
        case "=":
          conds.push(sql`${e} = ${String(cond.value)}`);
          break;
        case "!=":
          conds.push(sql`${e} <> ${String(cond.value)}`);
          break;
        case "contains":
          conds.push(sql`${e} ILIKE ${`%${String(cond.value)}%`}`);
          break;
        case ">":
          conds.push(sql`${e}::numeric > ${Number(cond.value)}`);
          break;
        case ">=":
          conds.push(sql`${e}::numeric >= ${Number(cond.value)}`);
          break;
        case "<":
          conds.push(sql`${e}::numeric < ${Number(cond.value)}`);
          break;
        case "<=":
          conds.push(sql`${e}::numeric <= ${Number(cond.value)}`);
          break;
        case "in": {
          const arr = Array.isArray(cond.value) ? cond.value.map(String) : [];
          conds.push(arr.length > 0 ? inArray(e, arr) : sql`1 = 0`);
          break;
        }
      }
    }
    // q (full-text) trên search_tsv (set khi insert/merge/replace từ field searchable).
    if (params.q?.trim()) {
      conds.push(sql`search_tsv @@ websearch_to_tsquery('simple', ${params.q.trim()})`);
    }
    return conds;
  }

  async list(
    companyId: string,
    _entityId: string,
    params: RecordListParams = {},
  ): Promise<{ rows: StoredRecord[]; total: number }> {
    const whereSql = sql.join(this.whereConds(companyId, params), sql` AND `);
    let orderSql = sql``;
    if (params.sort) {
      const dir = params.sort.dir === "desc" ? sql.raw("DESC") : sql.raw("ASC");
      orderSql = sql` ORDER BY ${this.textExpr(params.sort.field)} ${dir}`;
    }
    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;
    const rows = (
      await this.rows(
        sql`SELECT * FROM ${this.tbl} WHERE ${whereSql}${orderSql} LIMIT ${limit} OFFSET ${offset}`,
      )
    ).map((r) => this.toRecord(r));
    if (params.withTotal === false) return { rows, total: rows.length };
    const [c] = await this.rows(
      sql`SELECT count(*)::int AS count FROM ${this.tbl} WHERE ${whereSql}`,
    );
    return { rows, total: Number(c?.count ?? 0) };
  }

  async aggregate(
    companyId: string,
    _entityId: string,
    params: AggregateParams,
  ): Promise<Record<string, number>> {
    if (params.aggregates.length === 0) return {};
    const whereSql = sql.join(this.whereConds(companyId, params), sql` AND `);
    const parts = params.aggregates.map(
      (a, i) => sql`${aggExpr(a.fn, this.textExpr(a.field))} AS ${sql.raw(`a${i}`)}`,
    );
    const [row] = await this.rows(
      sql`SELECT ${sql.join(parts, sql`, `)} FROM ${this.tbl} WHERE ${whereSql}`,
    );
    return mapAggOut(params.aggregates, row);
  }

  async getById(companyId: string, recordId: string): Promise<StoredRecord | null> {
    const [row] = await this.rows(
      sql`SELECT * FROM ${this.tbl} WHERE id = ${recordId}::uuid AND company_id = ${companyId}::uuid LIMIT 1`,
    );
    return row ? this.toRecord(row) : null;
  }

  async getActiveById(
    companyId: string,
    _entityId: string,
    recordId: string,
  ): Promise<StoredRecord | null> {
    const [row] = await this.rows(
      sql`SELECT * FROM ${this.tbl} WHERE id = ${recordId}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL LIMIT 1`,
    );
    return row ? this.toRecord(row) : null;
  }

  async findByKeyIn(
    companyId: string,
    _entityId: string,
    field: string | null,
    values: string[],
  ): Promise<StoredRecord[]> {
    if (values.length === 0) return [];
    const e = field == null ? sql`id::text` : this.textExpr(field);
    const rows = await this.rows(
      sql`SELECT * FROM ${this.tbl} WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL AND ${inArray(e, values)}`,
    );
    return rows.map((r) => this.toRecord(r));
  }

  async loadState(companyId: string, recordId: string): Promise<RecordState | undefined> {
    const r = await this.getById(companyId, recordId);
    return r
      ? { entityId: r.entityId, data: r.data, version: r.version, deletedAt: r.deletedAt }
      : undefined;
  }

  async insert(
    companyId: string,
    _entityId: string,
    data: Record<string, unknown>,
    createdBy: string | null,
  ): Promise<StoredRecord | undefined> {
    const { cols, ext } = this.split(data);
    const colList = ["company_id", "created_by", ...cols.map((c) => `"${c.col}"`), "ext"];
    const vals = [
      sql`${companyId}::uuid`,
      createdBy == null ? sql`NULL` : sql`${createdBy}::uuid`,
      ...cols.map((c) => sql`${c.value}`),
      sql`${JSON.stringify(ext)}::jsonb`,
    ];
    const tsv = this.tsvText(data);
    if (tsv) {
      colList.push("search_tsv");
      vals.push(sql`to_tsvector('simple', ${tsv})`);
    }
    const [row] = await this.rows(
      sql`INSERT INTO ${this.tbl} (${sql.raw(colList.join(", "))}) VALUES (${sql.join(vals, sql`, `)}) RETURNING *`,
    );
    return row ? this.toRecord(row) : undefined;
  }

  async merge(
    companyId: string,
    recordId: string,
    patch: Record<string, unknown>,
    version: number,
  ): Promise<StoredRecord | undefined> {
    const { cols, ext } = this.split(patch);
    const sets: SQL[] = [
      ...cols.map((c) => sql`${sql.raw(`"${c.col}"`)} = ${c.value}`),
      sql`ext = ext || ${JSON.stringify(ext)}::jsonb`,
      sql`version = ${version}`,
      sql`updated_at = now()`,
    ];
    const [row] = await this.rows(
      sql`UPDATE ${this.tbl} SET ${sql.join(sets, sql`, `)} WHERE id = ${recordId}::uuid AND company_id = ${companyId}::uuid RETURNING *`,
    );
    // patch chạm field searchable → recompute search_tsv từ data đầy đủ (sau merge).
    if (row && (this.storage.searchable ?? []).some((f) => f in patch)) {
      const tsv = this.tsvText(this.toRecord(row).data as Record<string, unknown>);
      await this.db.execute(
        sql`UPDATE ${this.tbl} SET search_tsv = to_tsvector('simple', ${tsv}) WHERE id = ${recordId}::uuid`,
      );
    }
    return row ? this.toRecord(row) : undefined;
  }

  async replace(
    companyId: string,
    recordId: string,
    data: Record<string, unknown>,
    version: number,
  ): Promise<StoredRecord | undefined> {
    const sets: SQL[] = [];
    for (const [field, m] of Object.entries(this.storage.columns)) {
      const v = field in data ? coerceColumnValue(m.pgType, data[field]) : null;
      sets.push(sql`${sql.raw(`"${m.col}"`)} = ${v}`);
    }
    const ext: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) if (!this.storage.columns[k]) ext[k] = v;
    sets.push(
      sql`ext = ${JSON.stringify(ext)}::jsonb`,
      sql`version = ${version}`,
      sql`updated_at = now()`,
      // replace = thay toàn bộ → recompute search_tsv từ data đầy đủ.
      sql`search_tsv = to_tsvector('simple', ${this.tsvText(data)})`,
    );
    const [row] = await this.rows(
      sql`UPDATE ${this.tbl} SET ${sql.join(sets, sql`, `)} WHERE id = ${recordId}::uuid AND company_id = ${companyId}::uuid RETURNING *`,
    );
    return row ? this.toRecord(row) : undefined;
  }

  async softDelete(companyId: string, recordId: string): Promise<void> {
    await this.db.execute(
      sql`UPDATE ${this.tbl} SET deleted_at = now(), updated_at = now() WHERE id = ${recordId}::uuid AND company_id = ${companyId}::uuid`,
    );
  }

  async restore(companyId: string, recordId: string): Promise<void> {
    await this.db.execute(
      sql`UPDATE ${this.tbl} SET deleted_at = NULL, updated_at = now() WHERE id = ${recordId}::uuid AND company_id = ${companyId}::uuid`,
    );
  }

  async hardDelete(companyId: string, recordId: string): Promise<void> {
    await this.db.execute(
      sql`DELETE FROM ${this.tbl} WHERE id = ${recordId}::uuid AND company_id = ${companyId}::uuid`,
    );
  }

  async existsWithFieldValue(
    companyId: string,
    _entityId: string,
    field: string,
    value: string,
    excludeRecordId?: string,
  ): Promise<boolean> {
    const e = this.textExpr(field);
    const rows = await this.rows(
      sql`SELECT 1 FROM ${this.tbl} WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL AND ${e} = ${value}${excludeRecordId ? sql` AND id <> ${excludeRecordId}::uuid` : sql``} LIMIT 1`,
    );
    return rows.length > 0;
  }
}

/* ─── Dispatcher — route per-entity (meta.storage) + per-record (locator) ───
   Chỉ dùng khi ERP_HYBRID_TABLES=1. Op có entityId → tra meta; op chỉ-recordId
   → tra record_locator (chỉ chứa record tier='table'); không thấy → EAV. */

class DispatchRecordStore implements RecordStore {
  private readonly eav: EavRecordStore;
  private readonly metaCache = new Map<string, EntityStorage | null>();
  constructor(private readonly db: DB) {
    this.eav = new EavRecordStore(db);
  }

  private async storeForEntity(companyId: string, entityId: string): Promise<RecordStore> {
    let st = this.metaCache.get(entityId);
    if (st === undefined) {
      const [row] = await this.db
        .select({ meta: entities.meta })
        .from(entities)
        .where(and(eq(entities.id, entityId), eq(entities.companyId, companyId)));
      const storage = (row?.meta as { storage?: EntityStorage } | null)?.storage;
      st = storage?.tier === "table" ? storage : null;
      this.metaCache.set(entityId, st);
    }
    return st ? new TableRecordStore(this.db, entityId, st) : this.eav;
  }

  private async storeForRecord(companyId: string, recordId: string): Promise<RecordStore> {
    const [loc] = await this.db
      .select({ entityId: recordLocator.entityId })
      .from(recordLocator)
      .where(and(eq(recordLocator.id, recordId), eq(recordLocator.companyId, companyId)));
    return loc ? this.storeForEntity(companyId, loc.entityId) : this.eav;
  }

  async list(companyId: string, entityId: string, params?: RecordListParams) {
    return (await this.storeForEntity(companyId, entityId)).list(companyId, entityId, params);
  }
  async aggregate(companyId: string, entityId: string, params: AggregateParams) {
    return (await this.storeForEntity(companyId, entityId)).aggregate(companyId, entityId, params);
  }
  async getActiveById(companyId: string, entityId: string, recordId: string) {
    return (await this.storeForEntity(companyId, entityId)).getActiveById(
      companyId,
      entityId,
      recordId,
    );
  }
  async findByKeyIn(companyId: string, entityId: string, field: string | null, values: string[]) {
    return (await this.storeForEntity(companyId, entityId)).findByKeyIn(
      companyId,
      entityId,
      field,
      values,
    );
  }
  async existsWithFieldValue(
    companyId: string,
    entityId: string,
    field: string,
    value: string,
    excludeRecordId?: string,
  ) {
    return (await this.storeForEntity(companyId, entityId)).existsWithFieldValue(
      companyId,
      entityId,
      field,
      value,
      excludeRecordId,
    );
  }
  async insert(
    companyId: string,
    entityId: string,
    data: Record<string, unknown>,
    createdBy: string | null,
  ) {
    const store = await this.storeForEntity(companyId, entityId);
    const row = await store.insert(companyId, entityId, data, createdBy);
    // Record tier='table' → ghi locator để op chỉ-recordId định tuyến được.
    if (row && store !== this.eav) {
      await this.db
        .insert(recordLocator)
        .values({ id: row.id, companyId, entityId })
        .onConflictDoNothing();
    }
    return row;
  }
  async getById(companyId: string, recordId: string) {
    return (await this.storeForRecord(companyId, recordId)).getById(companyId, recordId);
  }
  async loadState(companyId: string, recordId: string, entityId?: string) {
    const store = entityId
      ? await this.storeForEntity(companyId, entityId)
      : await this.storeForRecord(companyId, recordId);
    return store.loadState(companyId, recordId, entityId);
  }
  async merge(
    companyId: string,
    recordId: string,
    patch: Record<string, unknown>,
    version: number,
  ) {
    return (await this.storeForRecord(companyId, recordId)).merge(
      companyId,
      recordId,
      patch,
      version,
    );
  }
  async replace(
    companyId: string,
    recordId: string,
    data: Record<string, unknown>,
    version: number,
  ) {
    return (await this.storeForRecord(companyId, recordId)).replace(
      companyId,
      recordId,
      data,
      version,
    );
  }
  async softDelete(companyId: string, recordId: string) {
    return (await this.storeForRecord(companyId, recordId)).softDelete(companyId, recordId);
  }
  async restore(companyId: string, recordId: string) {
    return (await this.storeForRecord(companyId, recordId)).restore(companyId, recordId);
  }
  async hardDelete(companyId: string, recordId: string) {
    const store = await this.storeForRecord(companyId, recordId);
    await store.hardDelete(companyId, recordId);
    if (store !== this.eav) {
      await this.db
        .delete(recordLocator)
        .where(and(eq(recordLocator.id, recordId), eq(recordLocator.companyId, companyId)));
    }
  }
}

/** Cờ bật lưu trữ HYBRID (bảng thật). Mặc định TẮT → EAV thuần (hành vi Phase 0). */
let HYBRID_TABLES: boolean | null = null;
export function isHybridTablesEnabled(): boolean {
  if (HYBRID_TABLES == null) HYBRID_TABLES = process.env.ERP_HYBRID_TABLES === "1";
  return HYBRID_TABLES;
}

/**
 * Lấy RecordStore cho `db`. Cờ TẮT → EavRecordStore (hành vi không đổi, không
 * thêm query). Cờ BẬT → DispatchRecordStore (route EAV vs bảng thật per-entity
 * + locator). LƯU Ý: nhánh bảng thật chưa verify runtime — cần Postgres e2e.
 */
export function getRecordStore(db: DB): RecordStore {
  return isHybridTablesEnabled() ? new DispatchRecordStore(db) : new EavRecordStore(db);
}
