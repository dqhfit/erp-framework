/* ==========================================================
   validate.ts — Validate-on-write: kiểm + ÉP KIỂU dữ liệu
   record theo định nghĩa field của entity. Pure logic.
   Xem UPGRADE-PLAN mục 3.5 (data governance).
   - Field rỗng → bỏ hẳn key (trừ khi required → lỗi).
   - Field lạ (không có trong định nghĩa) → bỏ qua.
   - Field formula → không nhận từ input (server tự tính).
   - Sai kiểu → lỗi; đúng → ép về kiểu JSON chuẩn.
   ========================================================== */
import type { EntityFieldDef } from "./datasource/index";
import type { PluginRegistry } from "./plugin/registry";
import { evalFieldRule } from "./field-rule";

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  /** Dữ liệu đã làm sạch + ép kiểu (rỗng nếu có lỗi). */
  data: Record<string, unknown>;
  errors: ValidationError[];
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null
    || (typeof v === "string" && v.trim() === "")
    || (Array.isArray(v) && v.length === 0);
}

/** Ép một giá trị về kiểu của field. Trả [giá-trị, lỗi|null]. */
function coerce(
  f: EntityFieldDef,
  raw: unknown,
  registry?: PluginRegistry,
): [unknown, string | null] {
  switch (f.type) {
    case "text":
      return [String(raw), null];

    case "number": {
      const n = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(n) ? [n, null] : [null, "Phải là số"];
    }

    case "boolean": {
      if (typeof raw === "boolean") return [raw, null];
      if (raw === "true" || raw === 1) return [true, null];
      if (raw === "false" || raw === 0) return [false, null];
      return [null, "Phải là true/false"];
    }

    case "date":
    case "datetime": {
      const d = raw instanceof Date ? raw : new Date(String(raw));
      if (Number.isNaN(d.getTime())) return [null, "Ngày/giờ không hợp lệ"];
      const iso = d.toISOString();
      return [f.type === "date" ? iso.slice(0, 10) : iso, null];
    }

    case "select": {
      const s = String(raw);
      if (f.options && !f.options.includes(s)) {
        return [null, `Giá trị phải thuộc: ${f.options.join(", ")}`];
      }
      return [s, null];
    }

    case "multiselect": {
      if (!Array.isArray(raw)) return [null, "Phải là danh sách"];
      const arr = raw.map(String);
      if (f.options) {
        const bad = arr.find((x) => !f.options!.includes(x));
        if (bad) return [null, `Giá trị "${bad}" không hợp lệ`];
      }
      return [arr, null];
    }

    // enum/multienum: chỉ ép kiểu chuỗi/mảng-chuỗi. Validate giá trị
    // thuộc enum tập trung làm ở tầng router/UI (cần truy DB), không
    // làm ở pure validate để giữ hàm không phụ thuộc I/O.
    case "enum":
      return [String(raw), null];

    case "multienum": {
      if (!Array.isArray(raw)) return [null, "Phải là danh sách"];
      return [raw.map(String), null];
    }

    case "relation":
    case "lookup":
      return [String(raw), null];

    case "multilookup": {
      if (!Array.isArray(raw)) return [null, "Phải là danh sách id"];
      return [raw.map(String), null];
    }

    case "json":
      return [raw, null];

    default: {
      // Kiểu field do plugin thêm — tra registry.
      const plugin = registry?.fieldType(f.type);
      if (plugin) {
        const r = plugin.coerce(raw, f);
        return "error" in r ? [null, r.error] : [r.value, null];
      }
      return [raw, null];
    }
  }
}

/**
 * Kiểm + ép kiểu một object record theo danh sách field.
 * @param opts.partial true cho update từng phần — chỉ kiểm field có
 *   mặt trong input, không bắt lỗi required với field vắng mặt.
 */
export function validateRecord(
  fields: EntityFieldDef[],
  input: Record<string, unknown>,
  opts: { partial?: boolean; registry?: PluginRegistry } = {},
): ValidationResult {
  const out: Record<string, unknown> = {};
  const errors: ValidationError[] = [];

  for (const f of fields) {
    if (f.type === "formula") continue;            // server tự tính
    if (f.type === "rollup") continue;             // server compute cross-row
    const present = f.name in input;
    if (opts.partial && !present) continue;        // partial: bỏ field vắng mặt

    const raw = input[f.name];
    if (isEmpty(raw)) {
      // Required tĩnh + requiredIf động (đè khi rule khớp).
      const required = f.required || evalFieldRule(f.requiredIf, input);
      if (required) errors.push({ field: f.name, message: "Bắt buộc nhập" });
      continue;                                     // bỏ hẳn key rỗng
    }

    const [val, err] = coerce(f, raw, opts.registry);
    if (err) errors.push({ field: f.name, message: err });
    else out[f.name] = val;
  }

  return { ok: errors.length === 0, data: out, errors };
}
