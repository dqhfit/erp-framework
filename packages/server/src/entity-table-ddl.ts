/* ==========================================================
   entity-table-ddl.ts — Dịch vụ DDL động cho lưu trữ HYBRID (Phase 1).

   Mỗi entity tier='table' có một bảng Postgres thật `er_<hex(entityId)>`:
     - cột hệ thống cố định (id/company_id/version/deleted_at/ext/…),
     - 1 cột typed cho mỗi field "cốt lõi" (vô hướng + quan hệ đơn),
     - cột `ext jsonb` cho field "mở rộng" (đa-trị/tính toán/json/encrypted).

   File này CHỈ lo: quyết tier field, map tên cột an toàn, sinh DDL, và
   thực thi DDL (advisory-lock serialize). KHÔNG đọc/ghi record (đó là
   TableRecordStore ở record-store.ts).

   AN TOÀN: tên entity/field do người dùng đặt → mọi identifier sinh ra
   ĐỀU qua slug + prefix (`er_`/`f_`) + assertIdent() (regex chặt) trước khi
   nội suy vào SQL thô. KHÔNG bao giờ nội suy tên thô của user vào DDL.

   Mapping bảo thủ (Phase 1): chỉ number→numeric, boolean→boolean; các kiểu
   cột-tier còn lại (gồm date/datetime/relation/lookup) → text để tránh lỗi
   coerce (xem bài học #9 về cột date). Phase 3 có thể tinh chỉnh date/numeric
   range khi đã có DB kiểm thử.
   ========================================================== */

import type { EntityFieldDef } from "@erp-framework/core";
import { sql } from "drizzle-orm";
import type { DB } from "./db";

/** Cột hệ thống cố định — field người dùng (prefix f_) không bao giờ đụng. */
export const SYSTEM_COLUMNS = [
  "id",
  "company_id",
  "version",
  "deleted_at",
  "search_tsv",
  "rollup_cache",
  "rollup_invalidated",
  "created_by",
  "created_at",
  "updated_at",
  "ext",
] as const;

export type ColumnPgType = "text" | "numeric" | "boolean";

/** Field type được lưu thành CỘT typed (vô hướng + quan hệ đơn). */
const COLUMN_TYPES = new Set([
  "text",
  "number",
  "boolean",
  "date",
  "datetime",
  "select",
  "enum",
  "sequence",
  "relation",
  "lookup",
]);

/** Field type KHÔNG có chỗ trong data (lưu bảng phụ) → bỏ qua khi map cột. */
const SIDE_TABLE_TYPES = new Set(["timeseries"]);

export type FieldTier = "column" | "ext" | "none";

/** Quyết định nơi lưu một field. encrypted → luôn ext (ciphertext không
 *  index/filter/sort SQL được). timeseries → none (bảng phụ). */
export function fieldTier(field: EntityFieldDef): FieldTier {
  if (SIDE_TABLE_TYPES.has(field.type)) return "none";
  if (field.encrypted) return "ext";
  return COLUMN_TYPES.has(field.type) ? "column" : "ext";
}

/** Kiểu cột Postgres cho field cột-tier (bảo thủ — xem header). */
export function pgTypeFor(field: EntityFieldDef): ColumnPgType {
  if (field.type === "number") return "numeric";
  if (field.type === "boolean") return "boolean";
  return "text";
}

/** Ép giá trị JS sang dạng hợp cột (fail-safe: dữ liệu xấu → NULL, không vỡ insert). */
export function coerceColumnValue(pgType: ColumnPgType, value: unknown): unknown {
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
  return typeof value === "string" ? value : String(value);
}

/** Slug → identifier an toàn (bỏ dấu, [^a-z0-9]→_, gọn). Rỗng → "x". */
export function slugIdent(name: string): string {
  const s = (name || "")
    .toLowerCase()
    .replace(/đ/g, "d") // đ (U+0111) KHÔNG decompose qua NFD → ánh xạ tay
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || "x";
}

/** Chặn identifier không an toàn trước khi nội suy vào SQL thô. */
export function assertIdent(ident: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(ident)) {
    throw new Error(`Identifier không an toàn cho DDL: "${ident}"`);
  }
  return ident;
}

/** Tên bảng ổn định theo entityId (hex, bỏ gạch) — không đổi khi đổi nhãn. */
export function tableNameForEntity(entityId: string): string {
  return assertIdent(`er_${entityId.replace(/-/g, "").toLowerCase()}`);
}

export interface ColumnDef {
  /** Tên field (key trong data). */
  field: string;
  /** Tên cột SQL (đã slug + prefix f_, dedupe, assert). */
  col: string;
  pgType: ColumnPgType;
  unique: boolean;
  indexed: boolean;
}

/** Mô tả lưu trữ ghi vào entities.meta.storage. */
export interface EntityStorage {
  tier: "table";
  tableName: string;
  /** fieldName → { col, pgType } cho field cột-tier. */
  columns: Record<string, { col: string; pgType: ColumnPgType }>;
  /** Phiên bản schema cột (tăng mỗi lần đổi cấu trúc — phục vụ chẩn đoán). */
  version: number;
}

/** Tính danh sách cột typed + ext từ fields. Dedupe tên cột (append _2..). */
export function buildColumnMap(fields: EntityFieldDef[]): {
  columns: ColumnDef[];
  extFields: string[];
} {
  const columns: ColumnDef[] = [];
  const extFields: string[] = [];
  const used = new Set<string>(SYSTEM_COLUMNS);
  for (const f of fields) {
    const tier = fieldTier(f);
    if (tier === "none") continue;
    if (tier === "ext") {
      extFields.push(f.name);
      continue;
    }
    let col = `f_${slugIdent(f.name)}`;
    if (col.length > 63) col = col.slice(0, 63);
    let cand = col;
    let i = 2;
    while (used.has(cand)) {
      const suffix = `_${i++}`;
      cand = col.slice(0, 63 - suffix.length) + suffix;
    }
    used.add(cand);
    columns.push({
      field: f.name,
      col: assertIdent(cand),
      pgType: pgTypeFor(f),
      unique: f.unique === true,
      indexed: f.filterable === true || f.sortable === true,
    });
  }
  return { columns, extFields };
}

/** Mô tả storage (pure) — entities-router lưu vào meta.storage. */
export function storageDescriptor(entityId: string, fields: EntityFieldDef[]): EntityStorage {
  const { columns } = buildColumnMap(fields);
  const map: Record<string, { col: string; pgType: ColumnPgType }> = {};
  for (const c of columns) map[c.field] = { col: c.col, pgType: c.pgType };
  return { tier: "table", tableName: tableNameForEntity(entityId), columns: map, version: 1 };
}

/** Tên index có cap 63 (Postgres truncate > 63 → tránh va chạm ngầm). */
function ixName(tableName: string, suffix: string): string {
  const n = `${tableName}_${suffix}`;
  return n.length > 63 ? n.slice(0, 63) : n;
}

/** DDL CREATE TABLE (idempotent IF NOT EXISTS). */
export function createTableDDL(tableName: string, columns: ColumnDef[]): string {
  assertIdent(tableName);
  const lines = [
    "id uuid PRIMARY KEY DEFAULT uuidv7()",
    "company_id uuid NOT NULL",
    ...columns.map((c) => `"${assertIdent(c.col)}" ${c.pgType}`),
    "ext jsonb NOT NULL DEFAULT '{}'::jsonb",
    "version integer NOT NULL DEFAULT 0",
    "deleted_at timestamptz",
    "search_tsv tsvector",
    "rollup_cache jsonb",
    "rollup_invalidated boolean NOT NULL DEFAULT true",
    "created_by uuid",
    "created_at timestamptz NOT NULL DEFAULT now()",
    "updated_at timestamptz NOT NULL DEFAULT now()",
  ];
  return `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  ${lines.join(",\n  ")}\n)`;
}

/** Index cho 1 cột: unique partial (active-only) nếu unique, else btree nếu indexed. */
export function columnIndexDDL(tableName: string, c: ColumnDef): string[] {
  assertIdent(tableName);
  assertIdent(c.col);
  if (c.unique) {
    return [
      `CREATE UNIQUE INDEX IF NOT EXISTS "${ixName(tableName, `${c.col}_uq`)}" ON "${tableName}" (company_id, "${c.col}") WHERE deleted_at IS NULL`,
    ];
  }
  if (c.indexed) {
    return [
      `CREATE INDEX IF NOT EXISTS "${ixName(tableName, `${c.col}_idx`)}" ON "${tableName}" ("${c.col}")`,
    ];
  }
  return [];
}

/** DDL index (idempotent). company/deleted/ext-gin + per-column filterable/unique. */
export function indexDDL(tableName: string, columns: ColumnDef[]): string[] {
  assertIdent(tableName);
  const out = [
    `CREATE INDEX IF NOT EXISTS "${ixName(tableName, "company_idx")}" ON "${tableName}" (company_id)`,
    `CREATE INDEX IF NOT EXISTS "${ixName(tableName, "deleted_idx")}" ON "${tableName}" (deleted_at)`,
    `CREATE INDEX IF NOT EXISTS "${ixName(tableName, "ext_gin")}" ON "${tableName}" USING gin (ext)`,
  ];
  for (const c of columns) out.push(...columnIndexDDL(tableName, c));
  return out;
}

/* ─── DDL biến đổi cột (Phase 2 dùng) ─── */

export function addColumnDDL(tableName: string, col: string, pgType: ColumnPgType): string {
  return `ALTER TABLE "${assertIdent(tableName)}" ADD COLUMN IF NOT EXISTS "${assertIdent(col)}" ${pgType}`;
}
export function dropColumnDDL(tableName: string, col: string): string {
  return `ALTER TABLE "${assertIdent(tableName)}" DROP COLUMN IF EXISTS "${assertIdent(col)}"`;
}
export function renameColumnDDL(tableName: string, from: string, to: string): string {
  return `ALTER TABLE "${assertIdent(tableName)}" RENAME COLUMN "${assertIdent(from)}" TO "${assertIdent(to)}"`;
}

/* ─── Thực thi ─── */

/**
 * Tạo (idempotent) bảng + index cho entity. Advisory-lock theo tên bảng để
 * serialize 2 request tạo cùng entity. Trả EntityStorage để lưu meta.storage.
 */
export async function ensureEntityTable(
  db: DB,
  entityId: string,
  fields: EntityFieldDef[],
): Promise<EntityStorage> {
  const tableName = tableNameForEntity(entityId);
  const { columns } = buildColumnMap(fields);
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tableName}))`);
    await tx.execute(sql.raw(createTableDDL(tableName, columns)));
    for (const ix of indexDDL(tableName, columns)) await tx.execute(sql.raw(ix));
  });
  return storageDescriptor(entityId, fields);
}

/* ─── Phase 2: đồng bộ schema khi sửa entity tier='table' ─── */

/**
 * Tính storage mới + cột cần ADD/DROP khi danh sách fields đổi (thêm/xoá field,
 * hoặc field chuyển tier). GIỮ tên cột cũ cho field không đổi (không đổi tên cột
 * ngầm). KHÔNG xử lý đổi pgType của field đang tồn tại (xem planFieldChange).
 */
export function planStorageSync(
  old: EntityStorage,
  fields: EntityFieldDef[],
): { next: EntityStorage; addColumns: ColumnDef[]; dropColumns: string[] } {
  const used = new Set<string>(SYSTEM_COLUMNS);
  for (const m of Object.values(old.columns)) used.add(m.col);
  const nextCols: Record<string, { col: string; pgType: ColumnPgType }> = {};
  const addColumns: ColumnDef[] = [];
  for (const f of fields) {
    if (fieldTier(f) !== "column") continue;
    const pgType = pgTypeFor(f);
    const existing = old.columns[f.name];
    if (existing) {
      nextCols[f.name] = { col: existing.col, pgType };
      continue;
    }
    let col = `f_${slugIdent(f.name)}`;
    if (col.length > 63) col = col.slice(0, 63);
    let cand = col;
    let i = 2;
    while (used.has(cand)) {
      const sfx = `_${i++}`;
      cand = col.slice(0, 63 - sfx.length) + sfx;
    }
    used.add(cand);
    nextCols[f.name] = { col: assertIdent(cand), pgType };
    addColumns.push({
      field: f.name,
      col: cand,
      pgType,
      unique: f.unique === true,
      indexed: f.filterable === true || f.sortable === true,
    });
  }
  const dropColumns: string[] = [];
  for (const [field, m] of Object.entries(old.columns)) {
    if (!nextCols[field]) dropColumns.push(m.col);
  }
  return {
    next: { tier: "table", tableName: old.tableName, columns: nextCols, version: old.version + 1 },
    addColumns,
    dropColumns,
  };
}

/** Thực thi ADD/DROP cột theo planStorageSync. Trả storage mới. Idempotent. */
export async function syncEntityTableSchema(
  db: DB,
  old: EntityStorage,
  fields: EntityFieldDef[],
): Promise<EntityStorage> {
  const { next, addColumns, dropColumns } = planStorageSync(old, fields);
  if (addColumns.length === 0 && dropColumns.length === 0) return next;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${old.tableName}))`);
    for (const c of addColumns) {
      await tx.execute(sql.raw(addColumnDDL(old.tableName, c.col, c.pgType)));
      for (const ix of columnIndexDDL(old.tableName, c)) await tx.execute(sql.raw(ix));
    }
    for (const col of dropColumns) await tx.execute(sql.raw(dropColumnDDL(old.tableName, col)));
  });
  return next;
}

/** Kế hoạch đổi 1 field trên bảng thật (đổi pgType / chuyển column↔ext). */
export type FieldChangePlan =
  | { kind: "none" }
  | { kind: "type"; col: string; newPgType: ColumnPgType }
  | { kind: "col-to-ext"; col: string }
  | { kind: "ext-to-col"; col: string; pgType: ColumnPgType };

export function planFieldChange(
  storage: EntityStorage,
  fieldName: string,
  newField: EntityFieldDef,
): { plan: FieldChangePlan; next: EntityStorage } {
  const existing = storage.columns[fieldName];
  const newTier = fieldTier(newField);
  const cols = { ...storage.columns };
  let plan: FieldChangePlan = { kind: "none" };
  if (existing && newTier === "column") {
    const newPgType = pgTypeFor(newField);
    if (newPgType !== existing.pgType) {
      plan = { kind: "type", col: existing.col, newPgType };
      cols[fieldName] = { col: existing.col, pgType: newPgType };
    }
  } else if (existing && newTier !== "column") {
    plan = { kind: "col-to-ext", col: existing.col };
    delete cols[fieldName];
  } else if (!existing && newTier === "column") {
    const used = new Set<string>(SYSTEM_COLUMNS);
    for (const m of Object.values(storage.columns)) used.add(m.col);
    let col = `f_${slugIdent(fieldName)}`;
    if (col.length > 63) col = col.slice(0, 63);
    let cand = col;
    let i = 2;
    while (used.has(cand)) {
      const sfx = `_${i++}`;
      cand = col.slice(0, 63 - sfx.length) + sfx;
    }
    const pgType = pgTypeFor(newField);
    plan = { kind: "ext-to-col", col: assertIdent(cand), pgType };
    cols[fieldName] = { col: cand, pgType };
  }
  return {
    plan,
    next: {
      tier: "table",
      tableName: storage.tableName,
      columns: cols,
      version: storage.version + 1,
    },
  };
}

/** Thực thi đổi field trên bảng thật (best-effort cast). Trả storage mới. */
export async function applyFieldChange(
  db: DB,
  storage: EntityStorage,
  fieldName: string,
  newField: EntityFieldDef,
): Promise<EntityStorage> {
  const { plan, next } = planFieldChange(storage, fieldName, newField);
  if (plan.kind === "none") return next;
  // tbl/col = identifier đã quote (đã assert an toàn) → nội suy qua sql.raw.
  // Khoá field (string literal) → tham số hoá (${fieldName}), KHÔNG nội suy thô.
  const tbl = sql.raw(`"${assertIdent(storage.tableName)}"`);
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${storage.tableName}))`);
    if (plan.kind === "type") {
      const col = sql.raw(`"${assertIdent(plan.col)}"`);
      const t = sql.raw(plan.newPgType);
      await tx.execute(
        sql`ALTER TABLE ${tbl} ALTER COLUMN ${col} TYPE ${t} USING ${col}::text::${t}`,
      );
    } else if (plan.kind === "col-to-ext") {
      const col = sql.raw(`"${assertIdent(plan.col)}"`);
      await tx.execute(
        sql`UPDATE ${tbl} SET ext = ext || jsonb_build_object(${fieldName}, to_jsonb(${col})) WHERE ${col} IS NOT NULL`,
      );
      await tx.execute(sql.raw(dropColumnDDL(storage.tableName, plan.col)));
    } else if (plan.kind === "ext-to-col") {
      const col = sql.raw(`"${assertIdent(plan.col)}"`);
      const t = sql.raw(plan.pgType);
      await tx.execute(sql.raw(addColumnDDL(storage.tableName, plan.col, plan.pgType)));
      await tx.execute(
        sql`UPDATE ${tbl} SET ${col} = (ext->>${fieldName})::${t}, ext = ext - ${fieldName} WHERE ext ? ${fieldName}`,
      );
    }
  });
  return next;
}

/**
 * Đổi tên field trên bảng thật: KHÔNG đổi tên cột vật lý (cột là opaque) —
 * chỉ đổi key map trong meta.columns (column-tier) HOẶC đổi key trong ext jsonb
 * (ext-tier). Trả storage mới (null nếu field là ext → caller chỉ cần ghi fields).
 */
export async function renameFieldOnTable(
  db: DB,
  storage: EntityStorage,
  oldKey: string,
  newKey: string,
): Promise<EntityStorage> {
  const existing = storage.columns[oldKey];
  if (existing) {
    const cols = { ...storage.columns };
    delete cols[oldKey];
    cols[newKey] = existing;
    return { ...storage, columns: cols, version: storage.version + 1 };
  }
  // ext-tier: đổi key trong ext jsonb của mọi row (khoá tham số hoá).
  const tbl = sql.raw(`"${assertIdent(storage.tableName)}"`);
  await db.execute(
    sql`UPDATE ${tbl} SET ext = (ext - ${oldKey}) || jsonb_build_object(${newKey}, ext->${oldKey}), updated_at = now() WHERE ext ? ${oldKey}`,
  );
  return { ...storage, version: storage.version + 1 };
}
