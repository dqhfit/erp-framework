import type { FieldDef, FieldType } from "@/types/entity";

/** Normalize bất kỳ shape data → array of objects (rows) */
export function normalizeRows(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    if (data.length && Array.isArray(data[0])) {
      return data.map((row) => {
        // Mutate accumulator thay vì spread mỗi iteration (noAccumulatingSpread).
        const out: Record<string, unknown> = {};
        (row as unknown[]).forEach((v, i) => {
          out[`col_${i + 1}`] = v;
        });
        return out;
      });
    }
    if (data.length && typeof data[0] !== "object") {
      return data.map((v) => ({ value: v }));
    }
    return data as Array<Record<string, unknown>>;
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const k of ["items", "data", "rows", "results", "list"]) {
      if (Array.isArray(obj[k])) return obj[k] as Array<Record<string, unknown>>;
    }
    if (Array.isArray(obj.columns) && Array.isArray(obj.rows)) {
      const cols = obj.columns as string[];
      return (obj.rows as unknown[][]).map((r) => {
        const o: Record<string, unknown> = {};
        cols.forEach((c, i) => {
          o[c] = r[i];
        });
        return o;
      });
    }
    return [obj];
  }
  return [];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\//i;
const PHONE_RE = /^[+\d][\d\s\-().]{6,}$/;

function inferTypeFromValue(v: unknown): FieldType {
  if (v == null) return "text";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") {
    return Number.isInteger(v) ? "integer" : "number";
  }
  if (typeof v === "object") return "json";
  if (typeof v === "string") {
    if (DATETIME_RE.test(v)) return "datetime";
    if (DATE_RE.test(v)) return "date";
    if (EMAIL_RE.test(v)) return "email";
    if (URL_RE.test(v)) return "url";
    if (PHONE_RE.test(v) && v.replace(/\D/g, "").length >= 8) return "phone";
    if (v.length > 200) return "textarea";
    return "text";
  }
  return "text";
}

/** Vote type giữa nhiều giá trị, ưu tiên non-null */
function voteType(vals: unknown[]): FieldType {
  const counts = new Map<FieldType, number>();
  for (const v of vals) {
    if (v == null) continue;
    const t = inferTypeFromValue(v);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  if (counts.size === 0) return "text";
  // Pick most common
  let best: FieldType = "text";
  let bestN = 0;
  for (const [t, n] of counts) {
    if (n > bestN) {
      best = t;
      bestN = n;
    }
  }
  // Promote integer → number nếu có lẫn float
  if (best === "integer" && counts.has("number")) return "number";
  return best;
}

export interface InferredField {
  _skip?: boolean;
  key: string;
  label: string;
  type: FieldType;
  sample: unknown;
  nullCount: number;
  uniqueCount: number;
  totalCount: number;
}

/** Snake-case key → human label */
function toLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Infer Schema từ rows */
export function inferSchema(rows: Array<Record<string, unknown>>): InferredField[] {
  if (!rows.length) return [];
  const allKeys = new Set<string>();
  for (const r of rows) {
    Object.keys(r).forEach((k) => {
      allKeys.add(k);
    });
  }
  const out: InferredField[] = [];
  for (const key of allKeys) {
    const vals = rows.map((r) => r[key]);
    const nonNull = vals.filter((v) => v != null);
    const unique = new Set(
      nonNull.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))),
    );
    out.push({
      key,
      label: toLabel(key),
      type: voteType(vals),
      sample: nonNull[0],
      nullCount: rows.length - nonNull.length,
      uniqueCount: unique.size,
      totalCount: rows.length,
    });
  }
  return out;
}

/** Convert inferred → FieldDef[] */
export function toFieldDefs(inferred: InferredField[]): FieldDef[] {
  return inferred.map((i) => ({
    key: i.key,
    label: i.label,
    type: i.type,
    required: i.nullCount === 0,
  }));
}
