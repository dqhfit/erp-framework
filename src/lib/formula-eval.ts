/* ==========================================================
   formula-eval.ts — Trình đánh giá công thức kiểu Excel.
   Hỗ trợ: phép tính cơ bản, so sánh, ghép chuỗi (&),
   tham chiếu ô (A1, A1:B5), và ~60 hàm thông dụng.
   ========================================================== */

export type Value = number | string | boolean;
export type CellGetter = (row: number, col: number, depth: number) => Value;

// ─── Địa chỉ ô ────────────────────────────────────────────────────────

export function colToLetter(c: number): string {
  let s = "";
  let n = c + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function letterToCol(s: string): number {
  let n = 0;
  for (const c of s.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function parseRef(ref: string): { row: number; col: number } {
  const m = ref.match(/^\$?([A-Z]+)\$?(\d+)$/i);
  if (!m) return { row: 0, col: 0 };
  return { col: letterToCol(m[1] ?? ""), row: Number.parseInt(m[2] ?? "1", 10) - 1 };
}

// ─── Tokenizer ─────────────────────────────────────────────────────────

type TT = "NUM" | "STR" | "BOOL" | "REF" | "IDENT" | "OP" | "LP" | "RP" | "COMMA" | "EOF";
interface Tok {
  t: TT;
  v: string;
}

// Safe char helpers
const ch = (s: string, i: number): string => s[i] ?? "";
const isDigit = (c: string) => c >= "0" && c <= "9";

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = ch(src, i);
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }

    // Number
    if (isDigit(c) || (c === "." && isDigit(ch(src, i + 1)))) {
      let s = "";
      while (i < src.length) {
        const cur = ch(src, i);
        if (isDigit(cur) || cur === ".") {
          s += cur;
          i++;
        } else if (
          (cur === "e" || cur === "E") &&
          (isDigit(ch(src, i + 1)) || ch(src, i + 1) === "+" || ch(src, i + 1) === "-")
        ) {
          s += cur + ch(src, i + 1);
          i += 2;
        } else break;
      }
      out.push({ t: "NUM", v: s });
      continue;
    }

    // String literal
    if (c === '"') {
      i++;
      let s = "";
      while (i < src.length) {
        const cur = ch(src, i);
        if (cur === '"' && ch(src, i + 1) === '"') {
          s += '"';
          i += 2;
        } else if (cur === '"') {
          i++;
          break;
        } else {
          s += cur;
          i++;
        }
      }
      out.push({ t: "STR", v: s });
      continue;
    }

    // Identifiers / cell refs / booleans — also handle leading $
    if (/[$A-Za-z_]/.test(c)) {
      let s = "";
      while (i < src.length) {
        const cur = ch(src, i);
        if (/[$A-Za-z_0-9]/.test(cur)) {
          if (cur !== "$") s += cur;
          i++;
        } else break;
      }
      const up = s.toUpperCase();
      if (up === "TRUE" || up === "FALSE") out.push({ t: "BOOL", v: up });
      else if (/^[A-Z]+\d+$/.test(up)) out.push({ t: "REF", v: up });
      else out.push({ t: "IDENT", v: up });
      continue;
    }

    // Two-char operators
    const two = c + ch(src, i + 1);
    if (two === "<=" || two === ">=" || two === "<>") {
      out.push({ t: "OP", v: two });
      i += 2;
      continue;
    }

    if (c === "(") {
      out.push({ t: "LP", v: c });
      i++;
      continue;
    }
    if (c === ")") {
      out.push({ t: "RP", v: c });
      i++;
      continue;
    }
    if (c === "," || c === ";") {
      out.push({ t: "COMMA", v: c });
      i++;
      continue;
    }
    if ("+-*/^&=<>:".includes(c)) {
      out.push({ t: "OP", v: c });
      i++;
      continue;
    }
    i++;
  }
  out.push({ t: "EOF", v: "" });
  return out;
}

// ─── Parser ────────────────────────────────────────────────────────────

interface Ctx {
  toks: Tok[];
  pos: number;
  get: CellGetter;
  depth: number;
}

const EOF_TOK: Tok = { t: "EOF", v: "" };
const peek = (c: Ctx): Tok => c.toks[c.pos] ?? EOF_TOK;
const eat = (c: Ctx): Tok => c.toks[c.pos++] ?? EOF_TOK;
const eatIf = (c: Ctx, t: TT): boolean => {
  if ((c.toks[c.pos] ?? EOF_TOK).t !== t) return false;
  c.pos++;
  return true;
};

// Range marker — expands lazily inside functions
const RANGE_PFX = "\x00R:";
const rangeKey = (a: string, b: string) => `${RANGE_PFX}${a}:${b}`;

function expand(v: Value, get: CellGetter, depth: number): Value[] {
  if (typeof v !== "string" || !v.startsWith(RANGE_PFX)) return [v];
  const inner = v.slice(RANGE_PFX.length);
  const colon = inner.indexOf(":");
  if (colon < 0) return [v];
  const s = parseRef(inner.slice(0, colon));
  const e = parseRef(inner.slice(colon + 1));
  const out: Value[] = [];
  for (let r = Math.min(s.row, e.row); r <= Math.max(s.row, e.row); r++)
    for (let col = Math.min(s.col, e.col); col <= Math.max(s.col, e.col); col++)
      out.push(get(r, col, depth));
  return out;
}

function nums(vals: Value[]): number[] {
  return vals
    .filter((v) => v !== "" && v !== false && v !== true)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

function truthy(v: Value): boolean {
  return v !== false && v !== 0 && v !== "" && v !== "FALSE";
}

function match(value: Value, criteria: string): boolean {
  const sv = String(value).toLowerCase();
  const nv = Number(value);
  const ops: Array<[string, (a: number, b: number) => boolean]> = [
    [">=", (a, b) => a >= b],
    ["<=", (a, b) => a <= b],
    ["<>", (a, b) => a !== b],
    ["=", (a, b) => a === b],
    [">", (a, b) => a > b],
    ["<", (a, b) => a < b],
  ];
  for (const [op, fn] of ops) {
    if (criteria.startsWith(op)) {
      const rest = criteria.slice(op.length).trim();
      const nb = Number(rest);
      return Number.isFinite(nb) ? fn(nv, nb) : fn(sv.localeCompare(rest.toLowerCase()), 0);
    }
  }
  if (criteria.includes("*") || criteria.includes("?")) {
    return new RegExp(`^${criteria.toLowerCase().replace(/\*/g, ".*").replace(/[?]/g, ".")}$`).test(
      sv,
    );
  }
  const nc = Number(criteria);
  return Number.isFinite(nc) && criteria !== "" ? nv === nc : sv === criteria.toLowerCase();
}

// Safe getters for indexed function args
const a0 = (raw: Value[]): Value => raw[0] ?? "";
const a1 = (raw: Value[]): Value => raw[1] ?? "";
const a2 = (raw: Value[]): Value => raw[2] ?? "";
const n0 = (raw: Value[]): number => Number(raw[0] ?? 0);
const n1 = (raw: Value[]): number => Number(raw[1] ?? 0);
const n2 = (raw: Value[]): number => Number(raw[2] ?? 0);
const s0 = (raw: Value[]): string => String(raw[0] ?? "");
const s1 = (raw: Value[]): string => String(raw[1] ?? "");
const s2 = (raw: Value[]): string => String(raw[2] ?? "");
const s3 = (raw: Value[]): string => String(raw[3] ?? "");

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: formula engine needs all cases
function callFn(name: string, raw: Value[], ctx: Ctx): Value {
  const g = ctx.get;
  const d = ctx.depth;
  const flat = () => raw.flatMap((v) => expand(v, g, d));

  switch (name) {
    // ─ Số học ─
    case "SUM":
      return nums(flat()).reduce((a, b) => a + b, 0);
    case "PRODUCT":
      return nums(flat()).reduce((a, b) => a * b, 1);
    case "AVERAGE": {
      const ns = nums(flat());
      return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : "#DIV/0!";
    }
    case "MIN": {
      const ns = nums(flat());
      return ns.length ? Math.min(...ns) : 0;
    }
    case "MAX": {
      const ns = nums(flat());
      return ns.length ? Math.max(...ns) : 0;
    }
    case "COUNT":
      return nums(flat()).length;
    case "COUNTA":
      return flat().filter((v) => v !== "" && v != null).length;
    case "COUNTBLANK":
      return flat().filter((v) => v === "").length;
    case "SUMPRODUCT": {
      const arrays = raw.map((v) => nums(expand(v, g, d)));
      const len = Math.min(...arrays.map((a) => a.length));
      let total = 0;
      for (let i = 0; i < len; i++) total += arrays.reduce((acc, a) => acc * (a[i] ?? 0), 1);
      return total;
    }
    case "ABS":
      return Math.abs(n0(raw));
    case "INT":
      return Math.floor(n0(raw));
    case "TRUNC":
      return Math.trunc(n0(raw));
    case "SIGN":
      return Math.sign(n0(raw));
    case "MOD":
      return n0(raw) % n1(raw);
    case "ROUND": {
      const p = 10 ** n1(raw);
      return Math.round(n0(raw) * p) / p;
    }
    case "ROUNDUP": {
      const p = 10 ** n1(raw);
      return Math.ceil(n0(raw) * p) / p;
    }
    case "ROUNDDOWN": {
      const p = 10 ** n1(raw);
      return Math.floor(n0(raw) * p) / p;
    }
    case "CEILING": {
      const s = n1(raw) || 1;
      return Math.ceil(n0(raw) / s) * s;
    }
    case "FLOOR": {
      const s = n1(raw) || 1;
      return Math.floor(n0(raw) / s) * s;
    }
    case "POWER":
      return n0(raw) ** n1(raw);
    case "SQRT":
      return Math.sqrt(n0(raw));
    case "EXP":
      return Math.exp(n0(raw));
    case "LN":
      return Math.log(n0(raw));
    case "LOG":
      return Math.log(n0(raw)) / Math.log(n1(raw) || 10);
    case "LOG10":
      return Math.log10(n0(raw));
    case "PI":
      return Math.PI;
    case "RAND":
      return Math.random();
    case "RANDBETWEEN":
      return Math.floor(Math.random() * (n1(raw) - n0(raw) + 1)) + n0(raw);
    case "EVEN": {
      const v = Math.ceil(Math.abs(n0(raw)) / 2) * 2;
      return n0(raw) < 0 ? -v : v;
    }
    case "ODD": {
      const v = Math.ceil(Math.abs(n0(raw)) / 2) * 2 - 1;
      return n0(raw) < 0 ? -v : v;
    }
    case "GCD": {
      const g2 = (a: number, b: number): number => (b === 0 ? a : g2(b, a % b));
      return nums(flat()).reduce(g2);
    }
    case "LCM": {
      const g2 = (a: number, b: number): number => (b === 0 ? a : g2(b, a % b));
      const lcm = (a: number, b: number) => (a * b) / g2(a, b);
      return nums(flat()).reduce(lcm);
    }
    case "N":
      return Number(a0(raw));

    // ─ Logic ─
    case "IF":
      return truthy(a0(raw)) ? a1(raw) : a2(raw);
    case "IFS": {
      for (let i = 0; i + 1 < raw.length; i += 2) if (truthy(raw[i] ?? "")) return raw[i + 1] ?? "";
      return "#N/A";
    }
    case "AND":
      return flat().every((v) => truthy(v));
    case "OR":
      return flat().some((v) => truthy(v));
    case "NOT":
      return !truthy(a0(raw));
    case "XOR": {
      let c2 = 0;
      for (const v of flat()) if (truthy(v)) c2++;
      return c2 % 2 === 1;
    }
    case "TRUE":
      return true;
    case "FALSE":
      return false;
    case "IFERROR": {
      const v = a0(raw);
      return typeof v === "string" && v.startsWith("#") ? a1(raw) : v;
    }
    case "IFNA": {
      const v = a0(raw);
      return v === "#N/A" ? a1(raw) : v;
    }
    case "SWITCH": {
      const expr = a0(raw);
      for (let i = 1; i + 1 < raw.length; i += 2) if (raw[i] === expr) return raw[i + 1] ?? "";
      return raw.length % 2 === 0 ? (raw[raw.length - 1] ?? "") : "#N/A";
    }

    // ─ Văn bản ─
    case "CONCAT":
    case "CONCATENATE":
      return flat().map(String).join("");
    case "LEFT":
      return s0(raw).slice(0, n1(raw) || 1);
    case "RIGHT": {
      const str = s0(raw);
      const n = n1(raw) || 1;
      return str.slice(Math.max(0, str.length - n));
    }
    case "MID":
      return s0(raw).slice(n1(raw) - 1, n1(raw) - 1 + n2(raw));
    case "LEN":
      return s0(raw).length;
    case "UPPER":
      return s0(raw).toUpperCase();
    case "LOWER":
      return s0(raw).toLowerCase();
    case "PROPER":
      return s0(raw)
        .replace(/\b\w/g, (c2) => c2.toUpperCase())
        .replace(/(?<=\w)\w/g, (c2) => c2.toLowerCase());
    case "TRIM":
      return s0(raw).trim().replace(/\s+/g, " ");
    case "SUBSTITUTE":
      return s0(raw).split(s1(raw)).join(s2(raw));
    case "REPLACE": {
      const str = s0(raw);
      const st = n1(raw) - 1;
      const l = n2(raw);
      return str.slice(0, st) + s3(raw) + str.slice(st + l);
    }
    case "REPT":
      return s0(raw).repeat(Math.max(0, n1(raw)));
    case "TEXT":
      return s0(raw);
    case "VALUE":
      return Number(a0(raw));
    case "FIND": {
      const idx = s1(raw).indexOf(s0(raw), n2(raw) - 1);
      return idx === -1 ? "#VALUE!" : idx + 1;
    }
    case "SEARCH": {
      const idx = s1(raw)
        .toLowerCase()
        .indexOf(s0(raw).toLowerCase(), n2(raw) - 1);
      return idx === -1 ? "#VALUE!" : idx + 1;
    }
    case "EXACT":
      return s0(raw) === s1(raw);
    case "T":
      return typeof a0(raw) === "string" ? s0(raw) : "";
    case "CHAR":
      return String.fromCharCode(n0(raw));
    case "CODE":
      return s0(raw).charCodeAt(0);
    case "CLEAN":
      // biome-ignore lint/suspicious/noControlCharactersInRegex: CLEAN của Excel chủ ý loại bỏ ký tự control U+0000..U+001F
      return s0(raw).replace(/[ -]/g, "");
    case "NUMBERVALUE":
      return Number(s0(raw).replace(/[^\d.-]/g, ""));

    // ─ Thống kê điều kiện ─
    case "COUNTIF": {
      const range = expand(a0(raw), g, d);
      return range.filter((v) => match(v, s1(raw))).length;
    }
    case "SUMIF": {
      const r1 = expand(a0(raw), g, d);
      const crit = s1(raw);
      const r2 = raw[2] !== undefined ? expand(a2(raw), g, d) : r1;
      return r1.reduce(
        (acc: number, v, i2) => (match(v, crit) ? acc + Number(r2[i2] ?? 0) : acc),
        0,
      );
    }
    case "AVERAGEIF": {
      const r1 = expand(a0(raw), g, d);
      const crit = s1(raw);
      const r2 = raw[2] !== undefined ? expand(a2(raw), g, d) : r1;
      const matched: number[] = [];
      r1.forEach((v, i2) => {
        if (match(v, crit)) matched.push(Number(r2[i2] ?? 0));
      });
      return matched.length ? matched.reduce((a, b) => a + b, 0) / matched.length : "#DIV/0!";
    }
    case "MAXIFS": {
      const r1 = expand(a0(raw), g, d),
        r2 = expand(a1(raw), g, d),
        crit = s2(raw);
      const ns = r2.reduce((acc: number[], v, i2) => {
        if (match(v, crit)) acc.push(Number(r1[i2] ?? 0));
        return acc;
      }, []);
      return ns.length ? Math.max(...ns) : 0;
    }
    case "MINIFS": {
      const r1 = expand(a0(raw), g, d),
        r2 = expand(a1(raw), g, d),
        crit = s2(raw);
      const ns = r2.reduce((acc: number[], v, i2) => {
        if (match(v, crit)) acc.push(Number(r1[i2] ?? 0));
        return acc;
      }, []);
      return ns.length ? Math.min(...ns) : 0;
    }
    case "STDEV":
    case "STDEVP": {
      const ns = nums(flat());
      if (ns.length < 2) return 0;
      const avg = ns.reduce((a, b) => a + b, 0) / ns.length;
      return Math.sqrt(
        ns.reduce((a, b) => a + (b - avg) ** 2, 0) /
          (name === "STDEVP" ? ns.length : ns.length - 1),
      );
    }
    case "MEDIAN": {
      const ns = nums(flat()).sort((a, b) => a - b);
      const m = Math.floor(ns.length / 2);
      return ns.length % 2 ? (ns[m] ?? 0) : ((ns[m - 1] ?? 0) + (ns[m] ?? 0)) / 2;
    }
    case "LARGE": {
      const ns = nums(expand(a0(raw), g, d)).sort((a, b) => b - a);
      return ns[n1(raw) - 1] ?? "#NUM!";
    }
    case "SMALL": {
      const ns = nums(expand(a0(raw), g, d)).sort((a, b) => a - b);
      return ns[n1(raw) - 1] ?? "#NUM!";
    }
    case "RANK": {
      const v = n0(raw);
      const ns = nums(expand(a1(raw), g, d)).sort((a, b) => (truthy(a2(raw)) ? a - b : b - a));
      const r = ns.indexOf(v);
      return r === -1 ? "#N/A" : r + 1;
    }
    case "PERCENTILE": {
      const ns = nums(expand(a0(raw), g, d)).sort((a, b) => a - b);
      const k = n1(raw);
      const idx = k * (ns.length - 1);
      const lo = Math.floor(idx),
        hi = Math.ceil(idx);
      return (ns[lo] ?? 0) + ((ns[hi] ?? 0) - (ns[lo] ?? 0)) * (idx - lo);
    }

    // ─ Tra cứu ─
    case "VLOOKUP": {
      const val = a0(raw),
        tbl = a1(raw),
        ci = n2(raw) - 1;
      if (typeof tbl !== "string" || !tbl.startsWith(RANGE_PFX)) return "#N/A";
      const inner = tbl.slice(RANGE_PFX.length);
      const colon = inner.indexOf(":");
      const s = parseRef(inner.slice(0, colon)),
        e = parseRef(inner.slice(colon + 1));
      for (let r = s.row; r <= e.row; r++) {
        if (String(g(r, s.col, d)).toLowerCase() === String(val).toLowerCase())
          return g(r, s.col + ci, d);
      }
      return "#N/A";
    }
    case "HLOOKUP": {
      const val = a0(raw),
        tbl = a1(raw),
        ri = n2(raw) - 1;
      if (typeof tbl !== "string" || !tbl.startsWith(RANGE_PFX)) return "#N/A";
      const inner = tbl.slice(RANGE_PFX.length);
      const colon = inner.indexOf(":");
      const s = parseRef(inner.slice(0, colon)),
        e = parseRef(inner.slice(colon + 1));
      for (let col = s.col; col <= e.col; col++) {
        if (String(g(s.row, col, d)).toLowerCase() === String(val).toLowerCase())
          return g(s.row + ri, col, d);
      }
      return "#N/A";
    }
    case "INDEX": {
      const tbl = a0(raw);
      if (typeof tbl !== "string" || !tbl.startsWith(RANGE_PFX)) return "#REF!";
      const inner = tbl.slice(RANGE_PFX.length);
      const colon = inner.indexOf(":");
      const s = parseRef(inner.slice(0, colon));
      return g(s.row + n1(raw) - 1, s.col + n2(raw) - 1, d);
    }
    case "MATCH": {
      const val = a0(raw),
        arr = expand(a1(raw), g, d),
        mt = n2(raw);
      if (mt === 0) {
        const idx = arr.findIndex((v) => String(v).toLowerCase() === String(val).toLowerCase());
        return idx === -1 ? "#N/A" : idx + 1;
      }
      return "#N/A";
    }
    case "CHOOSE": {
      const idx = n0(raw) - 1;
      return idx >= 0 && idx < raw.length - 1 ? (raw[idx + 1] ?? "") : "#VALUE!";
    }

    // ─ Ngày tháng ─
    case "TODAY":
      return new Date().toLocaleDateString("vi-VN");
    case "NOW":
      return new Date().toLocaleString("vi-VN");
    case "YEAR": {
      const dt = new Date(s0(raw));
      return Number.isNaN(dt.getTime()) ? "#VALUE!" : dt.getFullYear();
    }
    case "MONTH": {
      const dt = new Date(s0(raw));
      return Number.isNaN(dt.getTime()) ? "#VALUE!" : dt.getMonth() + 1;
    }
    case "DAY": {
      const dt = new Date(s0(raw));
      return Number.isNaN(dt.getTime()) ? "#VALUE!" : dt.getDate();
    }
    case "HOUR":
      return new Date(s0(raw)).getHours();
    case "MINUTE":
      return new Date(s0(raw)).getMinutes();
    case "SECOND":
      return new Date(s0(raw)).getSeconds();
    case "DATE":
      return `${String(n2(raw)).padStart(2, "0")}/${String(n1(raw)).padStart(2, "0")}/${n0(raw)}`;
    case "DATEDIF": {
      const d1 = new Date(s0(raw)),
        d2 = new Date(s1(raw)),
        unit = s2(raw).toUpperCase();
      const ms = d2.getTime() - d1.getTime();
      if (unit === "D") return Math.floor(ms / 86400000);
      if (unit === "M")
        return (d2.getFullYear() - d1.getFullYear()) * 12 + d2.getMonth() - d1.getMonth();
      if (unit === "Y") return d2.getFullYear() - d1.getFullYear();
      return "#VALUE!";
    }
    case "EDATE": {
      const dt = new Date(s0(raw));
      dt.setMonth(dt.getMonth() + n1(raw));
      return dt.toLocaleDateString("vi-VN");
    }
    case "EOMONTH": {
      const dt = new Date(s0(raw));
      dt.setMonth(dt.getMonth() + n1(raw) + 1);
      dt.setDate(0);
      return dt.toLocaleDateString("vi-VN");
    }
    case "WEEKDAY":
      return new Date(s0(raw)).getDay() + 1;
    case "WEEKNUM": {
      const dt = new Date(s0(raw));
      const jan1 = new Date(dt.getFullYear(), 0, 1);
      return Math.ceil(((dt.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
    }

    // ─ Thông tin ─
    case "ISBLANK": {
      const v = a0(raw);
      return v === "" || v == null;
    }
    case "ISNUMBER": {
      const v = a0(raw);
      return (
        typeof v === "number" || (typeof v === "string" && v !== "" && Number.isFinite(Number(v)))
      );
    }
    case "ISTEXT": {
      const v = a0(raw);
      return typeof v === "string" && !Number.isFinite(Number(v));
    }
    case "ISERROR": {
      const v = a0(raw);
      return typeof v === "string" && v.startsWith("#");
    }
    case "ISNA":
      return a0(raw) === "#N/A";
    case "NA":
      return "#N/A";
    case "ROWS": {
      const v = a0(raw);
      if (typeof v !== "string" || !v.startsWith(RANGE_PFX)) return 1;
      const inner = v.slice(RANGE_PFX.length);
      const colon = inner.indexOf(":");
      return (
        Math.abs(parseRef(inner.slice(0, colon)).row - parseRef(inner.slice(colon + 1)).row) + 1
      );
    }
    case "COLUMNS": {
      const v = a0(raw);
      if (typeof v !== "string" || !v.startsWith(RANGE_PFX)) return 1;
      const inner = v.slice(RANGE_PFX.length);
      const colon = inner.indexOf(":");
      return (
        Math.abs(parseRef(inner.slice(0, colon)).col - parseRef(inner.slice(colon + 1)).col) + 1
      );
    }
    case "ROW":
      return 0;
    case "COLUMN":
      return 0;

    default:
      return `#NAME?(${name})`;
  }
}

function pExpr(c: Ctx): Value {
  return pCmp(c);
}

function pCmp(c: Ctx): Value {
  const left = pConcat(c);
  const p = peek(c);
  if (p.t === "OP" && ["=", "<", ">", "<=", ">=", "<>"].includes(p.v)) {
    eat(c);
    const right = pConcat(c);
    const l: Value = left,
      r: Value = right;
    const lc = typeof l === "string" ? l : Number(l);
    const rc = typeof r === "string" ? r : Number(r);
    // biome-ignore lint/suspicious/noDoubleEquals: intentional coercion for Excel = and <> operators
    if (p.v === "=") return lc == rc;
    if (p.v === "<") return lc < rc;
    if (p.v === ">") return lc > rc;
    if (p.v === "<=") return lc <= rc;
    if (p.v === ">=") return lc >= rc;
    // biome-ignore lint/suspicious/noDoubleEquals: intentional coercion
    if (p.v === "<>") return lc != rc;
  }
  return left;
}

function pConcat(c: Ctx): Value {
  let v = pAdd(c);
  while (peek(c).t === "OP" && peek(c).v === "&") {
    eat(c);
    v = String(v) + String(pAdd(c));
  }
  return v;
}

function pAdd(c: Ctx): Value {
  let v = pMul(c);
  while (peek(c).t === "OP" && (peek(c).v === "+" || peek(c).v === "-")) {
    const op = eat(c).v;
    v = op === "+" ? Number(v) + Number(pMul(c)) : Number(v) - Number(pMul(c));
  }
  return v;
}

function pMul(c: Ctx): Value {
  let v = pExp(c);
  while (peek(c).t === "OP" && (peek(c).v === "*" || peek(c).v === "/")) {
    const op = eat(c).v;
    const r = pExp(c);
    v = op === "*" ? Number(v) * Number(r) : Number(r) === 0 ? "#DIV/0!" : Number(v) / Number(r);
  }
  return v;
}

function pExp(c: Ctx): Value {
  const base = pUnary(c);
  if (peek(c).t === "OP" && peek(c).v === "^") {
    eat(c);
    return Number(base) ** Number(pUnary(c));
  }
  return base;
}

function pUnary(c: Ctx): Value {
  if (peek(c).t === "OP" && peek(c).v === "-") {
    eat(c);
    return -Number(pPrimary(c));
  }
  if (peek(c).t === "OP" && peek(c).v === "+") {
    eat(c);
    return Number(pPrimary(c));
  }
  return pPrimary(c);
}

function pPrimary(c: Ctx): Value {
  const t = peek(c);
  if (t.t === "NUM") {
    eat(c);
    return Number(t.v);
  }
  if (t.t === "STR") {
    eat(c);
    return t.v;
  }
  if (t.t === "BOOL") {
    eat(c);
    return t.v === "TRUE";
  }
  if (t.t === "LP") {
    eat(c);
    const v = pExpr(c);
    eatIf(c, "RP");
    return v;
  }
  if (t.t === "REF") {
    eat(c);
    if (peek(c).t === "OP" && peek(c).v === ":") {
      eat(c);
      const t2 = eat(c);
      return rangeKey(t.v, t2.v);
    }
    const ref = parseRef(t.v);
    return c.get(ref.row, ref.col, c.depth);
  }
  if (t.t === "IDENT") {
    eat(c);
    if (peek(c).t === "LP") {
      eat(c);
      const args: Value[] = [];
      while ((c.toks[c.pos] ?? EOF_TOK).t !== "RP" && (c.toks[c.pos] ?? EOF_TOK).t !== "EOF") {
        args.push(pExpr(c));
        if ((c.toks[c.pos] ?? EOF_TOK).t === "COMMA") eat(c);
      }
      eatIf(c, "RP");
      return callFn(t.v, args, c);
    }
    return 0;
  }
  eat(c);
  return 0;
}

// ─── Public API ────────────────────────────────────────────────────────

export function evalFormula(formula: string, getCellValue: CellGetter, depth = 0): Value {
  if (depth > 50) return "#CIRC!";
  try {
    const toks = tokenize(formula);
    const ctx: Ctx = { toks, pos: 0, get: getCellValue, depth: depth + 1 };
    return pExpr(ctx);
  } catch {
    return "#ERROR!";
  }
}
