/* ==========================================================
   proc-table.ts — Helper cho module proc Tier D đọc/ghi BẢNG THẬT
   (HYBRID storage) đúng schema VẬT LÝ.

   VẤN ĐỀ: bảng thật do ensureEntityTable tạo có cột field prefix
   `f_<slug>` (vd f_order_number), PK là uuid (uuidv7); field có type
   ngoài built-in (vd "integer", "bool" từ migration) KHÔNG có cột
   riêng — nằm trong `ext` jsonb. Proc viết SQL thô theo tên cột nguồn
   (order_number, "IsLock", id int) sẽ lỗi "column does not exist".

   GIẢI PHÁP: đọc entities.meta.storage.columns lúc runtime (nguồn sự
   thật mà record-store/delta-sync/full-import đều dùng) rồi compose
   biểu thức cột đúng:
     - field có cột typed → "f_xxx"
     - field ext-tier     → (ext->>'TênField') + cast

   Ghi (insert/update) tách data theo mapping y hệt TableRecordStore:
   cột typed nhận giá trị coerce theo pgType, phần còn lại merge vào
   ext jsonb; tự tăng version, set updated_at, recompute search_tsv
   khi chạm field searchable. KHÔNG đụng record_locator (store cũng
   không ghi locator cho bảng thật).

   An toàn: mọi identifier nội suy raw đều qua assertIdent (regex
   chặt); mọi giá trị đi qua bind param; companyId + deleted_at được
   bake sẵn vào mọi WHERE (chống cross-tenant — bài học #17).
   ========================================================== */

import { type SQL, sql } from "drizzle-orm";

/** DB tối thiểu proc cần — khớp cấu trúc drizzle DB của server
 *  (postgres-js trả mảng row; node-postgres trả {rows}). */
export interface ProcDb {
  execute(query: SQL): Promise<unknown>;
}

/** Chuẩn hoá kết quả execute về mảng row. */
export function rows<T = Record<string, unknown>>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const r = (res as { rows?: T[] } | null)?.rows;
  return Array.isArray(r) ? r : [];
}

type ColumnPgType = "text" | "numeric" | "boolean";

interface StorageMeta {
  tier?: string;
  tableName?: string;
  columns?: Record<string, { col: string; pgType: ColumnPgType }>;
  searchable?: string[];
}

function assertIdent(ident: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(ident)) {
    throw new Error(`Identifier không an toàn: "${ident}"`);
  }
  return ident;
}

/** Ép giá trị JS sang dạng hợp cột typed (same coerceColumnValue của server —
 *  fail-safe: dữ liệu xấu → NULL, không vỡ insert). */
function coerce(pgType: ColumnPgType, value: unknown): unknown {
  if (value == null || value === "") return null;
  if (pgType === "numeric") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (pgType === "boolean") {
    if (value === true || value === "true" || value === 1 || value === "1") return true;
    if (value === false || value === "false" || value === 0 || value === "0") return false;
    return null;
  }
  // Date → ISO (String(Date) là chuỗi locale, vỡ cast/sort — same fix
  // coerceColumnValue của server).
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  return typeof value === "string" ? value : String(value);
}

export interface ProcTable {
  entityId: string;
  tableName: string;
  /** Fragment `"tablename"` cho FROM/UPDATE/INSERT. */
  tbl: SQL;
  /** Điều kiện chuẩn: company_id khớp + deleted_at IS NULL. */
  scope: SQL;
  /** field có cột typed? (false = nằm trong ext jsonb) */
  hasColumn(field: string): boolean;
  /** Biểu thức đọc field dạng text (so sánh chuỗi / ILIKE). */
  text(field: string): SQL;
  /** Biểu thức đọc field dạng numeric. */
  num(field: string): SQL;
  /** Biểu thức đọc field dạng boolean. */
  bool(field: string): SQL;
  /** Biểu thức đọc field dạng timestamp (cột text ISO / ext). */
  ts(field: string): SQL;
  /** Giá trị thô của field: cột typed → "col"; ext → ext->>'field' (text). */
  raw(field: string): SQL;
  /** SELECT các row khớp `where` (đã nằm trong scope), trả object keyed
   *  theo TÊN FIELD (cột typed map ngược + ext spread) + `_id` (uuid row).
   *  orderBy/limit/offset tuỳ chọn — orderBy compose từ t.text/num/ts ở caller. */
  listWhere(
    where: SQL,
    opts?: { orderBy?: SQL; limit?: number; offset?: number },
  ): Promise<Array<Record<string, unknown>>>;
  /** INSERT 1 row — tách data theo mapping; trả id uuid của row mới. */
  insertRow(data: Record<string, unknown>, createdBy?: string | null): Promise<string>;
  /** UPDATE các row khớp `where` (đã nằm trong scope) — SET cột typed +
   *  merge ext + version+1 + updated_at; recompute search_tsv nếu chạm
   *  field searchable. Trả số row đổi. */
  updateWhere(patch: Record<string, unknown>, where: SQL): Promise<number>;
  /** Soft-delete (deleted_at = now()) các row khớp. Trả số row. */
  softDeleteWhere(where: SQL): Promise<number>;
  /** Hard-delete các row khớp (chỉ dùng khi proc gốc DELETE thật). Trả số row. */
  hardDeleteWhere(where: SQL): Promise<number>;
}

/** Cache meta entity (TTL ngắn) — proc gọi lặp không re-query entities. */
const cache = new Map<string, { at: number; value: CachedEntity }>();
const CACHE_TTL_MS = 60_000;

interface CachedEntity {
  entityId: string;
  tableName: string;
  columns: Record<string, { col: string; pgType: ColumnPgType }>;
  searchable: string[];
  /** meta.sync.state — 'mirror' = MSSQL còn là nguồn sự thật, CHẶN ghi. */
  syncState: string | null;
  /** Tên field hợp lệ (entities.fields[].name) — validate key data khi ghi. */
  fieldNames: Set<string>;
}

async function loadEntity(
  db: ProcDb,
  companyId: string,
  entityName: string,
): Promise<CachedEntity> {
  const key = `${companyId}/${entityName.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const res = await db.execute(sql`
    SELECT id, fields, meta FROM entities
    WHERE company_id = ${companyId}::uuid AND lower(name) = lower(${entityName})
    LIMIT 1
  `);
  const [row] = rows<{
    id: string;
    fields: Array<{ name: string }> | null;
    meta: { storage?: StorageMeta; sync?: { state?: string } } | null;
  }>(res);
  if (!row) {
    throw new Error(`proc-table: entity "${entityName}" không tồn tại trong công ty`);
  }
  const storage = row.meta?.storage;
  if (storage?.tier !== "table" || !storage.tableName) {
    throw new Error(
      `proc-table: entity "${entityName}" không phải bảng thật (tier=${storage?.tier ?? "eav"}) — proc Tier D yêu cầu tier=table`,
    );
  }
  const value: CachedEntity = {
    entityId: row.id,
    tableName: assertIdent(storage.tableName),
    columns: storage.columns ?? {},
    searchable: storage.searchable ?? [],
    syncState: row.meta?.sync?.state ?? null,
    fieldNames: new Set((row.fields ?? []).map((f) => f.name)),
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Resolve entity tier=table theo tên (company-scoped) → ProcTable. */
export async function procTable(
  db: ProcDb,
  companyId: string,
  entityName: string,
): Promise<ProcTable> {
  const ent = await loadEntity(db, companyId, entityName);
  const tbl = sql.raw(`"${ent.tableName}"`);
  const scope = sql`company_id = ${companyId}::uuid AND deleted_at IS NULL`;

  // Biểu thức đọc cũng validate tên field — WHERE theo field sai case sẽ
  // thành ext->>'x' = NULL, khớp 0 row im lặng.
  const colOf = (field: string) => {
    if (ent.fieldNames.size > 0 && !ent.fieldNames.has(field)) {
      throw new Error(
        `proc-table: field "${field}" không tồn tại trên entity "${entityName}" — kiểm tra tên/case theo entities.fields`,
      );
    }
    return ent.columns[field];
  };

  // Cùng ngữ nghĩa assertEntityNotMirror của records-router: mirror = MSSQL
  // còn là nguồn sự thật, delta-sync sở hữu bảng — proc ghi vào sẽ bị sync
  // ghi đè/xung đột. Fail-closed cho MỌI đường ghi của helper.
  const assertWritable = () => {
    // Dev/local: cờ env cho ghi cả entity mirror (đồng nhất entity-write-guard
    // assertEntityNotMirror — prod KHÔNG đặt cờ → vẫn guard).
    if (process.env.ERP_ALLOW_MIRROR_WRITE === "1") return;
    if (ent.syncState === "mirror") {
      throw new Error(
        `proc-table: entity "${entityName}" đang mirror (sync 1 chiều từ MSSQL, chưa cutover) — không được ghi. Chờ cutover module hoặc chuyển sync.state sang 'live'.`,
      );
    }
  };

  // Key data PHẢI là field có thật của entity — chặn lệch tên/case (vd
  // "islock" vs field "IsLock") khiến giá trị rơi lạc vào ext mà field
  // thật không đổi (miswrite im lặng, rất khó truy).
  const assertKnownFields = (data: Record<string, unknown>) => {
    if (ent.fieldNames.size === 0) return; // entity thiếu fields — bỏ check
    const bad = Object.keys(data).filter((k) => !ent.fieldNames.has(k));
    if (bad.length > 0) {
      throw new Error(
        `proc-table: field không tồn tại trên entity "${entityName}": ${bad.join(", ")} — kiểm tra tên/case theo entities.fields`,
      );
    }
  };

  const exprText = (field: string): SQL => {
    const m = colOf(field);
    return m ? sql.raw(`"${assertIdent(m.col)}"::text`) : sql`(ext->>${field})`;
  };

  const t: ProcTable = {
    entityId: ent.entityId,
    tableName: ent.tableName,
    tbl,
    scope,
    hasColumn: (field) => Boolean(ent.columns[field]),
    text: exprText,
    // Cast PHẢI fail-safe (dữ liệu xấu → NULL, không vỡ query — same triết lý
    // coerceColumnValue): mirror data từng chứa 'Invalid Date', text '2' cho
    // cột bit... — cast trần ::timestamptz/::boolean nổ cả câu SELECT.
    num: (field) => {
      const m = colOf(field);
      const raw = m ? sql.raw(`"${assertIdent(m.col)}"`) : sql`(ext->>${field})`;
      if (m?.pgType === "numeric") return raw;
      return sql`(CASE WHEN ${raw}::text ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN ${raw}::text::numeric END)`;
    },
    bool: (field) => {
      const m = colOf(field);
      const raw = m ? sql.raw(`"${assertIdent(m.col)}"`) : sql`(ext->>${field})`;
      if (m?.pgType === "boolean") return raw;
      return sql`(CASE lower(${raw}::text) WHEN 'true' THEN true WHEN '1' THEN true WHEN 'false' THEN false WHEN '0' THEN false END)`;
    },
    ts: (field) => {
      const m = colOf(field);
      const raw = m ? sql.raw(`"${assertIdent(m.col)}"::text`) : sql`(ext->>${field})`;
      return sql`(CASE WHEN ${raw} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN ${raw}::timestamptz END)`;
    },
    raw: (field) => {
      const m = colOf(field);
      return m ? sql.raw(`"${assertIdent(m.col)}"`) : sql`(ext->>${field})`;
    },

    async listWhere(where, opts = {}) {
      const orderSql = opts.orderBy ? sql` ORDER BY ${opts.orderBy}` : sql``;
      const limitSql = opts.limit ? sql` LIMIT ${opts.limit}` : sql``;
      const offsetSql = opts.offset ? sql` OFFSET ${opts.offset}` : sql``;
      const res = await db.execute(
        sql`SELECT * FROM ${tbl} WHERE ${scope} AND (${where})${orderSql}${limitSql}${offsetSql}`,
      );
      return rows<Record<string, unknown>>(res).map((row) => {
        const data: Record<string, unknown> = {
          ...((row.ext as Record<string, unknown>) ?? {}),
        };
        for (const [field, m] of Object.entries(ent.columns)) {
          const v = row[m.col];
          if (v == null) continue;
          data[field] = m.pgType === "numeric" ? Number(v) : v;
        }
        data._id = row.id;
        return data;
      });
    },

    async insertRow(data, createdBy = null) {
      assertWritable();
      assertKnownFields(data);
      const cols: Array<{ col: string; value: unknown }> = [];
      const ext: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data)) {
        if (v === undefined) continue;
        const m = colOf(k);
        if (m) cols.push({ col: m.col, value: coerce(m.pgType, v) });
        else ext[k] = v;
      }
      const colList = [
        "company_id",
        "created_by",
        ...cols.map((c) => `"${assertIdent(c.col)}"`),
        "ext",
      ];
      const vals: SQL[] = [
        sql`${companyId}::uuid`,
        createdBy == null ? sql`NULL` : sql`${createdBy}::uuid`,
        ...cols.map((c) => sql`${c.value}`),
        sql`${JSON.stringify(ext)}::jsonb`,
      ];
      const tsv = ent.searchable
        .map((f) => (data[f] == null ? "" : String(data[f])))
        .filter(Boolean)
        .join(" ");
      if (tsv) {
        colList.push("search_tsv");
        vals.push(sql`to_tsvector('simple', ${tsv})`);
      }
      const res = await db.execute(
        sql`INSERT INTO ${tbl} (${sql.raw(colList.join(", "))}) VALUES (${sql.join(vals, sql`, `)}) RETURNING id`,
      );
      const [row] = rows<{ id: string }>(res);
      if (!row) throw new Error(`proc-table: INSERT vào "${ent.tableName}" không trả id`);
      return row.id;
    },

    async updateWhere(patch, where) {
      assertWritable();
      assertKnownFields(patch);
      const cols: Array<{ col: string; value: unknown }> = [];
      const ext: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        const m = colOf(k);
        if (m) cols.push({ col: m.col, value: coerce(m.pgType, v) });
        else ext[k] = v;
      }
      const sets: SQL[] = [
        ...cols.map((c) => sql`${sql.raw(`"${assertIdent(c.col)}"`)} = ${c.value}`),
        sql`version = version + 1`,
        sql`updated_at = now()`,
      ];
      if (Object.keys(ext).length > 0) {
        sets.push(sql`ext = ext || ${JSON.stringify(ext)}::jsonb`);
      }
      const res = await db.execute(
        sql`UPDATE ${tbl} SET ${sql.join(sets, sql`, `)} WHERE ${scope} AND (${where}) RETURNING id`,
      );
      const changed = rows<{ id: string }>(res);
      // Chạm field searchable → recompute search_tsv từ data đầy đủ sau update.
      if (changed.length > 0 && ent.searchable.some((f) => f in patch)) {
        const parts = ent.searchable.map((f) => sql`coalesce(${exprText(f)}, '')`);
        const concat = sql.join(parts, sql` || ' ' || `);
        const ids = changed.map((r) => r.id);
        await db.execute(
          sql`UPDATE ${tbl} SET search_tsv = to_tsvector('simple', ${concat}) WHERE id IN (SELECT unnest(${ids}::uuid[]))`,
        );
      }
      return changed.length;
    },

    async softDeleteWhere(where) {
      assertWritable();
      const res = await db.execute(
        sql`UPDATE ${tbl} SET deleted_at = now(), updated_at = now() WHERE ${scope} AND (${where}) RETURNING id`,
      );
      return rows(res).length;
    },

    async hardDeleteWhere(where) {
      assertWritable();
      const res = await db.execute(
        sql`DELETE FROM ${tbl} WHERE company_id = ${companyId}::uuid AND (${where}) RETURNING id`,
      );
      return rows(res).length;
    },
  };
  return t;
}

/** Xoá cache (test / sau khi đổi schema entity). */
export function clearProcTableCache(): void {
  cache.clear();
}
