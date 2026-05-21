/* ==========================================================
   formula.ts — Formula expressions cho field type "formula"
   - Cú pháp:  {field_name}  → reference field khác
               FUNC(arg, ...) → gọi hàm trong catalog
               + - * / % ()    → arithmetic
   - Evaluator dùng `new Function` + destructure catalog
     thành local vars (an toàn cả trong strict mode / ES modules).
   - Không có file/network/eval-tùy-tiện; chỉ chạy toán + hàm.
   ========================================================== */

export type FormulaCategory = "math" | "logic" | "text" | "date" | "agg";

export interface FormulaFn {
  name: string;
  category: FormulaCategory;
  args: string;          // Vd: "(value, [decimals])"
  hint: string;          // Mô tả ngắn
  example: string;       // Vd: "ROUND(price * 1.1, 2)"
  fn: (...args: any[]) => unknown;
}

// Coerce helpers (an toàn với null/undefined/empty)
const num = (v: unknown): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => v === null || v === undefined ? "" : String(v);
const toArr = (v: unknown): unknown[] => Array.isArray(v) ? v : [v];

// ============= Function catalog =============
export const FORMULA_FUNCTIONS: FormulaFn[] = [
  // ---- Math ----
  { name: "SUM",     category: "math", args: "(...nums)",         hint: "Cộng tất cả tham số",         example: "SUM(price, tax, shipping)",
    fn: (...args) => args.flatMap(toArr).reduce((s: number, v) => s + num(v), 0) },
  { name: "AVG",     category: "math", args: "(...nums)",         hint: "Trung bình cộng",             example: "AVG(q1, q2, q3, q4)",
    fn: (...args) => { const xs = args.flatMap(toArr); return xs.length ? xs.reduce((s: number, v) => s + num(v), 0) / xs.length : 0; } },
  { name: "MIN",     category: "math", args: "(...nums)",         hint: "Giá trị nhỏ nhất",            example: "MIN(price, min_price)",
    fn: (...args) => Math.min(...args.flatMap(toArr).map(num)) },
  { name: "MAX",     category: "math", args: "(...nums)",         hint: "Giá trị lớn nhất",            example: "MAX(price, list_price)",
    fn: (...args) => Math.max(...args.flatMap(toArr).map(num)) },
  { name: "ROUND",   category: "math", args: "(value, decimals?)", hint: "Làm tròn",                    example: "ROUND(total * 0.1, 2)",
    fn: (v, d = 0) => { const p = Math.pow(10, num(d)); return Math.round(num(v) * p) / p; } },
  { name: "CEIL",    category: "math", args: "(value)",           hint: "Làm tròn lên",                example: "CEIL(qty / 12)",
    fn: (v) => Math.ceil(num(v)) },
  { name: "FLOOR",   category: "math", args: "(value)",           hint: "Làm tròn xuống",              example: "FLOOR(price)",
    fn: (v) => Math.floor(num(v)) },
  { name: "ABS",     category: "math", args: "(value)",           hint: "Trị tuyệt đối",               example: "ABS(diff)",
    fn: (v) => Math.abs(num(v)) },
  { name: "POW",     category: "math", args: "(base, exp)",       hint: "Luỹ thừa",                    example: "POW(2, 10)",
    fn: (b, e) => Math.pow(num(b), num(e)) },
  { name: "MOD",     category: "math", args: "(a, b)",            hint: "a mod b",                     example: "MOD(n, 2)",
    fn: (a, b) => num(a) % num(b) },

  // ---- Logic ----
  { name: "IF",      category: "logic", args: "(cond, then, else)", hint: "Rẽ nhánh điều kiện",         example: 'IF({total}>1000, "VIP", "Thường")',
    fn: (c, t, e) => (c ? t : e) },
  { name: "AND",     category: "logic", args: "(...bools)",         hint: "Tất cả đúng",                example: "AND({age}>=18, {hasLicense})",
    fn: (...args) => args.every(Boolean) },
  { name: "OR",      category: "logic", args: "(...bools)",         hint: "Có ít nhất 1 đúng",          example: 'OR({status}="paid", {status}="shipped")',
    fn: (...args) => args.some(Boolean) },
  { name: "NOT",     category: "logic", args: "(bool)",             hint: "Đảo logic",                  example: "NOT({deleted})",
    fn: (v) => !v },
  { name: "COALESCE",category: "logic", args: "(...values)",        hint: "Trả về cái đầu tiên non-null", example: "COALESCE({nickname}, {name}, 'Anon')",
    fn: (...args) => args.find((v) => v !== null && v !== undefined && v !== "") },
  { name: "ISEMPTY", category: "logic", args: "(value)",            hint: "Trả true nếu null/'' /[]",   example: "ISEMPTY({phone})",
    fn: (v) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0) },

  // ---- Text ----
  { name: "CONCAT",  category: "text", args: "(...strs)",          hint: "Nối chuỗi",                   example: 'CONCAT({first}, " ", {last})',
    fn: (...args) => args.map(str).join("") },
  { name: "UPPER",   category: "text", args: "(s)",                hint: "VIẾT HOA",                    example: "UPPER({code})",
    fn: (v) => str(v).toUpperCase() },
  { name: "LOWER",   category: "text", args: "(s)",                hint: "viết thường",                 example: "LOWER({email})",
    fn: (v) => str(v).toLowerCase() },
  { name: "TRIM",    category: "text", args: "(s)",                hint: "Bỏ space đầu/cuối",           example: "TRIM({input})",
    fn: (v) => str(v).trim() },
  { name: "LEN",     category: "text", args: "(s)",                hint: "Độ dài chuỗi",                example: "LEN({description})",
    fn: (v) => str(v).length },
  { name: "LEFT",    category: "text", args: "(s, n)",             hint: "n ký tự đầu",                 example: 'LEFT({phone}, 3)',
    fn: (v, n) => str(v).slice(0, num(n)) },
  { name: "RIGHT",   category: "text", args: "(s, n)",             hint: "n ký tự cuối",                example: "RIGHT({code}, 4)",
    fn: (v, n) => { const s = str(v); return s.slice(Math.max(0, s.length - num(n))); } },
  { name: "REPLACE", category: "text", args: "(s, find, repl)",    hint: "Thay thế chuỗi con",          example: 'REPLACE({sku}, "-", "_")',
    fn: (s, f, r) => str(s).split(str(f)).join(str(r)) },
  { name: "CONTAINS",category: "text", args: "(s, sub)",           hint: "Có chứa chuỗi con không",     example: 'CONTAINS({tags}, "vip")',
    fn: (s, x) => str(s).includes(str(x)) },
  { name: "FORMAT_VND", category: "text", args: "(n)",             hint: "Format số → 1.234.567 ₫",     example: "FORMAT_VND({total})",
    fn: (v) => num(v).toLocaleString("vi-VN") + " ₫" },

  // ---- Date ----
  { name: "TODAY",   category: "date", args: "()",                 hint: "Ngày hôm nay (YYYY-MM-DD)",   example: "TODAY()",
    fn: () => new Date().toISOString().slice(0, 10) },
  { name: "NOW",     category: "date", args: "()",                 hint: "Thời điểm hiện tại ISO",      example: "NOW()",
    fn: () => new Date().toISOString() },
  { name: "YEAR",    category: "date", args: "(date)",             hint: "Năm",                         example: "YEAR({created_at})",
    fn: (v) => new Date(str(v)).getFullYear() },
  { name: "MONTH",   category: "date", args: "(date)",             hint: "Tháng 1-12",                  example: "MONTH({order_date})",
    fn: (v) => new Date(str(v)).getMonth() + 1 },
  { name: "DAY",     category: "date", args: "(date)",             hint: "Ngày 1-31",                   example: "DAY({order_date})",
    fn: (v) => new Date(str(v)).getDate() },
  { name: "DAYS_BETWEEN", category: "date", args: "(d1, d2)",      hint: "Số ngày chênh lệch",          example: "DAYS_BETWEEN({due_date}, TODAY())",
    fn: (a, b) => Math.round((new Date(str(a)).getTime() - new Date(str(b)).getTime()) / 86400000) },

  // ---- Aggregate (cho array fields) ----
  { name: "COUNT",   category: "agg", args: "(array)",             hint: "Số phần tử mảng",             example: "COUNT({items})",
    fn: (v) => Array.isArray(v) ? v.length : 0 },
];

export const FORMULA_FUNCTIONS_BY_NAME: Record<string, FormulaFn> =
  Object.fromEntries(FORMULA_FUNCTIONS.map((f) => [f.name, f]));

// ============= Evaluator =============

export interface EvalResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

/**
 * Evaluate `expr` trong context của `row`.
 * - Thay `{field_name}` bằng `row["field_name"]`
 * - Hàm trong catalog được expose qua `with(fn) { ... }`
 *
 * @example
 *   evaluate("{price} * {qty}", { price: 100, qty: 3 }) → { ok: true, value: 300 }
 *   evaluate('IF({total}>1000,"VIP","Thường")', { total: 1500 }) → "VIP"
 */
// Tên hàm hợp lệ làm JS identifier (chỉ A-Z, _) — pre-compute cho generator
const FN_NAMES = FORMULA_FUNCTIONS.map((f) => f.name);

export function evaluate(expr: string, row: Record<string, unknown>): EvalResult {
  if (!expr || !expr.trim()) return { ok: true, value: undefined };

  // Resolve {field} → row.field — escape các ký tự đặc biệt trong key
  const code = expr.replace(/\{([a-zA-Z_$][\w$]*)\}/g, (_, k) => {
    return `row[${JSON.stringify(k)}]`;
  });

  // Build callable namespace
  const ns: Record<string, unknown> = {};
  for (const f of FORMULA_FUNCTIONS) ns[f.name] = f.fn;

  // Destructure hàm thành local consts (an toàn trong strict mode)
  const destructure = `const { ${FN_NAMES.join(", ")} } = fn;`;

  try {
    // eslint-disable-next-line no-new-func
    const f = new Function("row", "fn", `${destructure} return (${code});`);
    return { ok: true, value: f(row ?? {}, ns) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Validate expression — chạy thử với row mẫu để check syntax/runtime.
 */
export function validateExpression(expr: string, sampleRow: Record<string, unknown> = {}): EvalResult {
  return evaluate(expr, sampleRow);
}

/**
 * Trích danh sách field key được reference trong expression (cho data deps).
 */
export function extractRefs(expr: string): string[] {
  const refs = new Set<string>();
  expr.replace(/\{([a-zA-Z_$][\w$]*)\}/g, (_, k) => { refs.add(k); return ""; });
  return [...refs];
}
