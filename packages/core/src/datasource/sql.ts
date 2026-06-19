/* ==========================================================
   sql.ts — Mặt soạn thảo SQL cho "Nguồn dữ liệu". Dành cho người
   quen viết T-SQL: viết SELECT/JOIN/WHERE/ORDER BY quen thuộc →
   parse → DataSourceConfig (qua DSL) → resolver an toàn chạy.

   QUAN TRỌNG: KHÔNG chạy SQL thô lên DB. SQL ở đây chỉ là CÚ PHÁP
   tác giả — compile sang cùng config id-based mà Canvas/Cấu hình/DSL
   dùng, nên giữ nguyên multi-tenant + RBAC theo field + giải mã +
   aggregate ở tầng JS. Round-trip 2 chiều: sqlToDataSource ⇄
   dataSourceToSql.

   Tập con hỗ trợ (map gọn sang config):
     SELECT  node.field [AS key] | node.* | *
             | (SELECT COUNT(*)|SUM(col)|AVG|MIN|MAX FROM Child c
                 WHERE c.fk = base.id) AS key      -- aggregate 1-N
     FROM    <Entity> [AS] base
     [LEFT|INNER] JOIN <Entity> [AS] alias
             ON parent.fromField = alias.toField
     WHERE   base.field <op> value [AND ...]        -- CHỈ field gốc
     ORDER BY <key|node.field> [ASC|DESC]
     LIMIT n | SELECT TOP n ...                     -- cả 2 cú pháp

   T-SQL niceties: nhận `TOP n`, định danh `[ngoặc vuông]` / "nháy kép",
   chuỗi 'nháy đơn' (escape ''), comment hai gạch và block, `<>` = `!=`,
   `LIKE '%x%'` → contains, `IN (...)` → in.

   Pure, không I/O — tái dùng client (editor) + server + migration.
   ========================================================== */

import type { DataSourceConfig, DataSourceField } from "./config";
import {
  compileDataSourceDsl,
  type DataSourceDsl,
  type DataSourceDslAgg,
  type DataSourceDslColumn,
  type DataSourceDslJoin,
  type DslEntity,
  decompileToDsl,
  indexEntitiesByName,
} from "./dsl";
import type { FilterOp } from "./index";

export interface SqlCompileResult {
  config: DataSourceConfig;
  /** Lỗi chặn — KHÔNG nên apply. */
  errors: string[];
  /** Cảnh báo — vẫn apply được. */
  warnings: string[];
}

/* ═══════════════════════ Tokenizer ═══════════════════════ */

type TokKind = "id" | "str" | "num" | "punct" | "kw";
interface Tok {
  kind: TokKind;
  /** Giá trị đã chuẩn hoá: id = tên thật (bỏ ngoặc/nháy), str = nội dung. */
  value: string;
  /** kw/punct chuẩn hoá HOA để so khớp. */
  up: string;
}

const KEYWORDS = new Set([
  "SELECT",
  "TOP",
  "DISTINCT",
  "FROM",
  "AS",
  "LEFT",
  "RIGHT",
  "INNER",
  "OUTER",
  "JOIN",
  "ON",
  "WHERE",
  "AND",
  "OR",
  "NOT",
  "ORDER",
  "GROUP",
  "BY",
  "HAVING",
  "ASC",
  "DESC",
  "LIMIT",
  "OFFSET",
  "IN",
  "LIKE",
  "IS",
  "NULL",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
]);

/** Bỏ comment `-- …` (đến hết dòng) và `/* … *​/` (block, không lồng). */
function stripComments(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const c2 = sql[i + 1];
    if (c === "'") {
      // chuỗi — copy nguyên, tôn trọng '' escape
      out += c;
      i++;
      while (i < n) {
        out += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            out += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "-" && c2 === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      out += " ";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function tokenize(sql: string): Tok[] {
  const s = stripComments(sql);
  const toks: Tok[] = [];
  let i = 0;
  const n = s.length;
  const isIdStart = (ch: string) => /[A-Za-z_]/.test(ch);
  const isIdPart = (ch: string) => /[A-Za-z0-9_]/.test(ch);
  while (i < n) {
    const c = s[i] as string;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    // chuỗi 'literal' (escape '')
    if (c === "'") {
      i++;
      let v = "";
      while (i < n) {
        if (s[i] === "'") {
          if (s[i + 1] === "'") {
            v += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        v += s[i];
        i++;
      }
      toks.push({ kind: "str", value: v, up: v });
      continue;
    }
    // định danh [ngoặc vuông] (T-SQL) hoặc "nháy kép"
    if (c === "[" || c === '"') {
      const close = c === "[" ? "]" : '"';
      i++;
      let v = "";
      while (i < n && s[i] !== close) {
        v += s[i];
        i++;
      }
      i++; // bỏ close
      toks.push({ kind: "id", value: v, up: v.toUpperCase() });
      continue;
    }
    // số
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(s[i + 1] ?? ""))) {
      let v = "";
      while (i < n && /[0-9.]/.test(s[i] as string)) {
        v += s[i];
        i++;
      }
      toks.push({ kind: "num", value: v, up: v });
      continue;
    }
    // định danh thường / keyword
    if (isIdStart(c)) {
      let v = "";
      while (i < n && isIdPart(s[i] as string)) {
        v += s[i];
        i++;
      }
      const up = v.toUpperCase();
      toks.push({ kind: KEYWORDS.has(up) ? "kw" : "id", value: v, up });
      continue;
    }
    // toán tử nhiều ký tự
    const two = s.slice(i, i + 2);
    if (two === ">=" || two === "<=" || two === "<>" || two === "!=") {
      toks.push({ kind: "punct", value: two, up: two });
      i += 2;
      continue;
    }
    // ký tự đơn
    toks.push({ kind: "punct", value: c, up: c });
    i++;
  }
  return toks;
}

/* ═══════════════════════ Parser ═══════════════════════ */

/** Cursor đọc token tuần tự. */
class Cursor {
  constructor(
    readonly toks: Tok[],
    public pos = 0,
  ) {}
  peek(o = 0): Tok | undefined {
    return this.toks[this.pos + o];
  }
  next(): Tok | undefined {
    return this.toks[this.pos++];
  }
  eof(): boolean {
    return this.pos >= this.toks.length;
  }
  /** Token tiếp là keyword `kw`? */
  isKw(kw: string, o = 0): boolean {
    const t = this.peek(o);
    return !!t && t.kind === "kw" && t.up === kw;
  }
  isPunct(p: string, o = 0): boolean {
    const t = this.peek(o);
    return !!t && t.kind === "punct" && t.up === p;
  }
}

const STOP_KW = new Set(["FROM", "WHERE", "ORDER", "GROUP", "HAVING", "LIMIT", "OFFSET"]);
const AGG_FNS = new Set(["COUNT", "SUM", "AVG", "MIN", "MAX"]);

/** Một mục SELECT đã parse. */
type SelectItem =
  | { kind: "col"; node: string; field: string; star: boolean; as?: string }
  | { kind: "starAll"; as?: undefined } // bare *
  | { kind: "agg"; agg: DataSourceDslAgg };

/** Đọc 1 định danh (id hoặc keyword-dùng-như-tên). */
function readName(cur: Cursor): string | null {
  const t = cur.peek();
  if (!t) return null;
  if (t.kind === "id" || (t.kind === "kw" && !STOP_KW.has(t.up))) {
    cur.next();
    return t.value;
  }
  return null;
}

/** Parse `node.field` | `node.*` | `field` (→ base). */
function parseColRef(cur: Cursor): { node?: string; field: string; star: boolean } | null {
  const first = readName(cur);
  if (first == null) {
    // có thể là `*`
    if (cur.isPunct("*")) {
      cur.next();
      return { field: "*", star: true };
    }
    return null;
  }
  if (cur.isPunct(".")) {
    cur.next();
    if (cur.isPunct("*")) {
      cur.next();
      return { node: first, field: "*", star: true };
    }
    const field = readName(cur);
    if (field == null) return null;
    return { node: first, field, star: false };
  }
  return { field: first, star: false };
}

/** Parse subquery aggregate: `( SELECT fn(arg) FROM Child c WHERE c.fk = src.match )`. */
function parseAggSubquery(cur: Cursor, errors: string[]): DataSourceDslAgg | null {
  // đang ở "("
  const start = cur.pos;
  cur.next(); // (
  if (!cur.isKw("SELECT")) {
    cur.pos = start;
    return null;
  }
  cur.next(); // SELECT
  const fnTok = cur.peek();
  if (!fnTok || fnTok.kind !== "kw" || !AGG_FNS.has(fnTok.up)) {
    errors.push("Subquery aggregate phải bắt đầu COUNT/SUM/AVG/MIN/MAX.");
    return null;
  }
  const fn = fnTok.up.toLowerCase() as DataSourceDslAgg["fn"];
  cur.next();
  if (!cur.isPunct("(")) {
    errors.push(`Aggregate ${fn.toUpperCase()} thiếu '('.`);
    return null;
  }
  cur.next(); // (
  // arg: * | col | node.col
  let valueField: string | undefined;
  if (cur.isPunct("*")) {
    cur.next();
  } else {
    const ref = parseColRef(cur);
    if (ref && !ref.star) valueField = ref.field;
  }
  if (!cur.isPunct(")")) {
    errors.push(`Aggregate ${fn.toUpperCase()} thiếu ')'.`);
    return null;
  }
  cur.next(); // )
  if (fn === "count") valueField = undefined; // count(*) — bỏ value
  // FROM Child [AS] c
  if (!cur.isKw("FROM")) {
    errors.push("Subquery aggregate thiếu FROM.");
    return null;
  }
  cur.next();
  const ofEntity = readName(cur);
  if (ofEntity == null) {
    errors.push("Subquery aggregate thiếu tên entity con sau FROM.");
    return null;
  }
  let childAlias = "";
  if (cur.isKw("AS")) cur.next();
  if (cur.peek()?.kind === "id") childAlias = cur.next()?.value ?? "";
  // WHERE c.fk = src.match
  if (!cur.isKw("WHERE")) {
    errors.push(`Subquery aggregate '${ofEntity}' thiếu WHERE liên kết (c.fk = base.id).`);
    return null;
  }
  cur.next();
  const lhs = parseColRef(cur);
  if (!cur.isPunct("=")) {
    errors.push(`Subquery aggregate '${ofEntity}': điều kiện liên kết phải dạng =.`);
    return null;
  }
  cur.next();
  const rhs = parseColRef(cur);
  if (!lhs || !rhs || lhs.star || rhs.star) {
    errors.push(`Subquery aggregate '${ofEntity}': WHERE liên kết không hợp lệ.`);
    return null;
  }
  // Bên nào trỏ entity con (childAlias hoặc ofEntity) = byField; bên kia = nguồn.
  const isChild = (r: { node?: string }) =>
    !!r.node &&
    (r.node.toLowerCase() === childAlias.toLowerCase() ||
      r.node.toLowerCase() === ofEntity.toLowerCase());
  let byField: string;
  let src: { node?: string; field: string };
  if (isChild(lhs)) {
    byField = lhs.field;
    src = rhs;
  } else if (isChild(rhs)) {
    byField = rhs.field;
    src = lhs;
  } else {
    errors.push(
      `Subquery aggregate '${ofEntity}': WHERE phải nối cột entity con với node nguồn (vd c.fk = base.id).`,
    );
    return null;
  }
  if (!cur.isPunct(")")) {
    errors.push(`Subquery aggregate '${ofEntity}' thiếu ')' đóng.`);
    return null;
  }
  cur.next(); // )
  const matchField = src.field && src.field.toLowerCase() !== "id" ? src.field : undefined;
  return {
    as: "", // điền sau theo alias AS
    fn,
    of: ofEntity,
    byField,
    ...(src.node ? { from: src.node } : {}),
    ...(matchField ? { matchField } : {}),
    ...(valueField ? { valueField } : {}),
  };
}

/** Parse danh sách SELECT đến khi gặp FROM. */
function parseSelectList(
  cur: Cursor,
  errors: string[],
  warnings: string[],
): { items: SelectItem[]; top?: number } {
  const items: SelectItem[] = [];
  let top: number | undefined;
  if (cur.isKw("DISTINCT")) {
    warnings.push("DISTINCT bị bỏ qua (nguồn dữ liệu không khử trùng dòng).");
    cur.next();
  }
  if (cur.isKw("TOP")) {
    cur.next();
    const t = cur.peek();
    if (t?.kind === "num") {
      top = Number.parseInt(t.value, 10);
      cur.next();
    }
  }
  // đọc các item ngăn cách dấu phẩy, dừng ở FROM
  for (;;) {
    if (cur.eof() || cur.isKw("FROM")) break;
    // subquery aggregate?
    if (cur.isPunct("(")) {
      const agg = parseAggSubquery(cur, errors);
      if (agg) {
        const as = readAsAlias(cur);
        if (!as) {
          errors.push("Cột subquery aggregate cần đặt tên qua AS.");
        } else {
          agg.as = as;
          items.push({ kind: "agg", agg });
        }
      } else {
        // skip tới dấu phẩy/FROM để tránh kẹt
        skipToCommaOrFrom(cur);
      }
    } else {
      const ref = parseColRef(cur);
      if (!ref) {
        errors.push(`Không đọc được cột SELECT tại '${cur.peek()?.value ?? "?"}'.`);
        skipToCommaOrFrom(cur);
      } else if (ref.star && !ref.node) {
        items.push({ kind: "starAll" });
      } else {
        const as = readAsAlias(cur);
        items.push({
          kind: "col",
          node: ref.node ?? "",
          field: ref.field,
          star: ref.star,
          ...(as ? { as } : {}),
        });
      }
    }
    if (cur.isPunct(",")) {
      cur.next();
      continue;
    }
    break;
  }
  return { items, ...(top != null ? { top } : {}) };
}

/** Đọc `[AS] alias` nếu có (không nuốt keyword clause). */
function readAsAlias(cur: Cursor): string | undefined {
  if (cur.isKw("AS")) {
    cur.next();
    return cur.next()?.value;
  }
  const t = cur.peek();
  // alias trần: id ngay sau item, không phải dấu phẩy / FROM / clause kw
  if (t && t.kind === "id") {
    cur.next();
    return t.value;
  }
  return undefined;
}

function skipToCommaOrFrom(cur: Cursor): void {
  let depth = 0;
  while (!cur.eof()) {
    if (cur.isPunct("(")) depth++;
    else if (cur.isPunct(")")) depth--;
    else if (depth === 0 && (cur.isPunct(",") || cur.isKw("FROM"))) return;
    cur.next();
  }
}

/* ─── Mệnh đề FROM + JOIN ─── */
interface ParsedJoin {
  alias: string;
  entity: string;
  parentNode: string;
  fromField: string;
  toField?: string;
  kind: "left" | "inner";
}

function parseFromJoins(
  cur: Cursor,
  errors: string[],
): { baseEntity: string; baseAlias: string; joins: ParsedJoin[] } | null {
  if (!cur.isKw("FROM")) {
    errors.push("Thiếu mệnh đề FROM.");
    return null;
  }
  cur.next();
  const baseEntity = readName(cur);
  if (baseEntity == null) {
    errors.push("FROM thiếu tên đối tượng gốc.");
    return null;
  }
  let baseAlias = baseEntity;
  if (cur.isKw("AS")) {
    cur.next();
    baseAlias = cur.next()?.value ?? baseEntity;
  } else if (cur.peek()?.kind === "id") {
    baseAlias = cur.next()?.value ?? baseEntity;
  }

  const joins: ParsedJoin[] = [];
  for (;;) {
    let kind: "left" | "inner" = "inner";
    if (cur.isKw("LEFT")) {
      kind = "left";
      cur.next();
      if (cur.isKw("OUTER")) cur.next();
    } else if (cur.isKw("INNER")) {
      kind = "inner";
      cur.next();
    } else if (cur.isKw("RIGHT")) {
      errors.push("RIGHT JOIN không hỗ trợ (mô hình cây gốc base).");
      return null;
    }
    if (!cur.isKw("JOIN")) {
      if (kind === "left") errors.push("LEFT thiếu JOIN.");
      break;
    }
    cur.next(); // JOIN
    const entity = readName(cur);
    if (entity == null) {
      errors.push("JOIN thiếu tên đối tượng.");
      return null;
    }
    let alias = entity;
    if (cur.isKw("AS")) {
      cur.next();
      alias = cur.next()?.value ?? entity;
    } else if (cur.peek()?.kind === "id") {
      alias = cur.next()?.value ?? entity;
    }
    if (!cur.isKw("ON")) {
      errors.push(`JOIN "${alias}" thiếu ON.`);
      return null;
    }
    cur.next(); // ON
    const lhs = parseColRef(cur);
    if (!cur.isPunct("=")) {
      errors.push(`JOIN "${alias}": ON phải dạng a.x = b.y.`);
      return null;
    }
    cur.next();
    const rhs = parseColRef(cur);
    if (!lhs || !rhs || lhs.star || rhs.star || !lhs.node || !rhs.node) {
      errors.push(`JOIN "${alias}": ON phải nối 2 cột có tiền tố (vd base.kh_id = kh.id).`);
      return null;
    }
    // Bên nào trỏ alias mới = toField; bên kia = node cha + fromField.
    const sameAlias = (nd?: string) => !!nd && nd.toLowerCase() === alias.toLowerCase();
    let parentNode: string;
    let fromField: string;
    let toField: string;
    if (sameAlias(rhs.node)) {
      parentNode = lhs.node as string;
      fromField = lhs.field;
      toField = rhs.field;
    } else if (sameAlias(lhs.node)) {
      parentNode = rhs.node as string;
      fromField = rhs.field;
      toField = lhs.field;
    } else {
      errors.push(`JOIN "${alias}": ON phải tham chiếu chính alias "${alias}".`);
      return null;
    }
    joins.push({
      alias,
      entity,
      parentNode,
      fromField,
      ...(toField.toLowerCase() !== "id" ? { toField } : {}),
      kind,
    });
  }
  return { baseEntity, baseAlias, joins };
}

/* ─── WHERE → baseFilters (chỉ field gốc) ─── */
function parseWhere(
  cur: Cursor,
  baseRefs: Set<string>,
  errors: string[],
  warnings: string[],
): Record<string, { op: FilterOp; value: unknown }> {
  const out: Record<string, { op: FilterOp; value: unknown }> = {};
  cur.next(); // WHERE
  for (;;) {
    if (
      cur.eof() ||
      cur.isKw("ORDER") ||
      cur.isKw("GROUP") ||
      cur.isKw("LIMIT") ||
      cur.isKw("OFFSET") ||
      cur.isKw("HAVING")
    )
      break;
    const ref = parseColRef(cur);
    if (!ref || ref.star) {
      errors.push("WHERE: không đọc được tên cột.");
      break;
    }
    const cond = parseCondition(cur, errors);
    if (cond) {
      const onBase = !ref.node || baseRefs.has(ref.node.toLowerCase());
      if (onBase) {
        out[ref.field] = cond;
      } else {
        warnings.push(
          `WHERE trên "${ref.node}.${ref.field}" bị bỏ qua — cấp nguồn dữ liệu chỉ lọc được field gốc; lọc field join ở widget.`,
        );
      }
    }
    if (cur.isKw("AND")) {
      cur.next();
      continue;
    }
    if (cur.isKw("OR")) {
      errors.push("WHERE chỉ hỗ trợ AND (lọc gốc theo AND). OR chưa hỗ trợ.");
      break;
    }
    break;
  }
  return out;
}

/** Parse `<op> value` | `LIKE '%x%'` | `IN (a,b)` | `IS [NOT] NULL`. */
function parseCondition(cur: Cursor, errors: string[]): { op: FilterOp; value: unknown } | null {
  const t = cur.peek();
  if (!t) return null;
  // LIKE '%x%' → contains
  if (cur.isKw("LIKE")) {
    cur.next();
    const v = cur.next();
    const raw = v?.kind === "str" ? v.value : "";
    return { op: "contains", value: raw.replace(/^%|%$/g, "") };
  }
  if (cur.isKw("IN")) {
    cur.next();
    if (!cur.isPunct("(")) {
      errors.push("IN thiếu '('.");
      return null;
    }
    cur.next();
    const vals: unknown[] = [];
    while (!cur.eof() && !cur.isPunct(")")) {
      const x = cur.next();
      if (x && (x.kind === "str" || x.kind === "num" || x.kind === "id")) {
        vals.push(x.kind === "num" ? Number(x.value) : x.value);
      }
      if (cur.isPunct(",")) cur.next();
    }
    if (cur.isPunct(")")) cur.next();
    return { op: "in", value: vals };
  }
  // toán tử so sánh
  const opMap: Record<string, FilterOp> = {
    "=": "=",
    "!=": "!=",
    "<>": "!=",
    ">": ">",
    ">=": ">=",
    "<": "<",
    "<=": "<=",
  };
  if (t.kind === "punct" && opMap[t.up]) {
    cur.next();
    const v = cur.next();
    if (!v) {
      errors.push(`Thiếu giá trị sau '${t.up}'.`);
      return null;
    }
    const value = v.kind === "num" ? Number(v.value) : v.up === "NULL" ? null : v.value;
    return { op: opMap[t.up] as FilterOp, value };
  }
  errors.push(`Toán tử WHERE không hỗ trợ tại '${t.value}'.`);
  return null;
}

/* ─── ORDER BY / LIMIT ─── */
function parseOrderBy(cur: Cursor): { node?: string; field: string; dir: "asc" | "desc" } | null {
  cur.next(); // ORDER
  if (cur.isKw("BY")) cur.next();
  const ref = parseColRef(cur);
  if (!ref || ref.star) return null;
  let dir: "asc" | "desc" = "asc";
  if (cur.isKw("DESC")) {
    dir = "desc";
    cur.next();
  } else if (cur.isKw("ASC")) {
    cur.next();
  }
  return { ...(ref.node ? { node: ref.node } : {}), field: ref.field, dir };
}

/* ═══════════════════════ SQL → Config ═══════════════════════ */

export function sqlToDataSource(sql: string, entities: DslEntity[]): SqlCompileResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const empty: DataSourceConfig = { baseEntityId: "", relations: [], fields: [] };

  const toks = tokenize(sql);
  if (toks.length === 0) {
    errors.push("Câu lệnh rỗng.");
    return { config: empty, errors, warnings };
  }
  const cur = new Cursor(toks);
  if (!cur.isKw("SELECT")) {
    errors.push("Câu lệnh phải bắt đầu bằng SELECT.");
    return { config: empty, errors, warnings };
  }
  cur.next(); // SELECT

  const { items, top } = parseSelectList(cur, errors, warnings);
  const from = parseFromJoins(cur, errors);
  if (!from) return { config: empty, errors, warnings };

  // Catalog tra field (index theo nhãn + tên kỹ thuật) để mở rộng `node.*` + map base.
  const byName = indexEntitiesByName(entities);

  // Tên-node hợp lệ để map column.from: base (qua tên gốc / alias / "base" /
  // nhãn / tên kỹ thuật của entity gốc) + alias join.
  const baseEntRef = byName.get(from.baseEntity.toLowerCase());
  const baseRefs = new Set<string>([
    "base",
    from.baseEntity.toLowerCase(),
    from.baseAlias.toLowerCase(),
    ...(baseEntRef ? [baseEntRef.name.toLowerCase()] : []),
    ...(baseEntRef?.techName ? [baseEntRef.techName.trim().toLowerCase()] : []),
  ]);
  const aliasToEntity = new Map<string, string>(); // aliasLower → entity NAME
  for (const j of from.joins) aliasToEntity.set(j.alias.toLowerCase(), j.entity);
  const resolveEntityOfNode = (nodeLower: string): DslEntity | undefined => {
    if (baseRefs.has(nodeLower)) return byName.get(from.baseEntity.toLowerCase());
    const ent = aliasToEntity.get(nodeLower);
    return ent ? byName.get(ent.toLowerCase()) : undefined;
  };

  // Build DSL joins.
  const dslJoins: DataSourceDslJoin[] = from.joins.map((j) => ({
    as: j.alias,
    from: baseRefs.has(j.parentNode.toLowerCase()) ? from.baseEntity : j.parentNode,
    fromField: j.fromField,
    to: j.entity,
    ...(j.toField ? { toField: j.toField } : {}),
    kind: j.kind,
  }));

  // Build DSL columns + aggregates.
  const dslColumns: DataSourceDslColumn[] = [];
  const dslAggs: DataSourceDslAgg[] = [];
  const nodeFromName = (nodeLower: string): string =>
    baseRefs.has(nodeLower)
      ? from.baseEntity
      : aliasToEntity.has(nodeLower)
        ? nodeLower
        : nodeLower;

  for (const it of items) {
    if (it.kind === "agg") {
      // map node nguồn của aggregate (from) về tên gốc nếu là base.
      const a = { ...it.agg };
      if (a.from) {
        const low = a.from.toLowerCase();
        a.from = baseRefs.has(low) ? from.baseEntity : a.from;
      }
      dslAggs.push(a);
      continue;
    }
    if (it.kind === "starAll") {
      const ent = byName.get(from.baseEntity.toLowerCase());
      if (!ent) {
        warnings.push("'*' không mở rộng được — chưa rõ đối tượng gốc.");
        continue;
      }
      for (const f of ent.fields) dslColumns.push({ from: from.baseEntity, field: f.name });
      continue;
    }
    // col
    const nodeLower = (it.node || "").toLowerCase();
    const nodeRef = it.node ? nodeFromName(nodeLower) : from.baseEntity;
    if (it.star) {
      const ent = resolveEntityOfNode(nodeLower || from.baseAlias.toLowerCase());
      if (!ent) {
        warnings.push(`'${it.node}.*' không mở rộng được — node không xác định.`);
        continue;
      }
      for (const f of ent.fields) dslColumns.push({ from: nodeRef, field: f.name });
      continue;
    }
    dslColumns.push({
      from: nodeRef,
      field: it.field,
      ...(it.as ? { as: it.as } : {}),
    });
  }

  const dsl: DataSourceDsl = {
    base: from.baseEntity,
    joins: dslJoins,
    columns: dslColumns,
    ...(dslAggs.length ? { aggregates: dslAggs } : {}),
    ...(top != null ? { limit: top } : {}),
  };

  // WHERE / ORDER BY / LIMIT (sau JOINs).
  let baseFilters: Record<string, { op: FilterOp; value: unknown }> | undefined;
  let orderBy: { node?: string; field: string; dir: "asc" | "desc" } | null = null;
  let limitN: number | undefined = top;
  while (!cur.eof()) {
    if (cur.isKw("WHERE")) {
      baseFilters = parseWhere(cur, baseRefs, errors, warnings);
    } else if (cur.isKw("ORDER")) {
      orderBy = parseOrderBy(cur);
    } else if (cur.isKw("GROUP") || cur.isKw("HAVING")) {
      warnings.push(`Mệnh đề ${cur.peek()?.up} chưa hỗ trợ — bỏ qua.`);
      cur.next();
      while (!cur.eof() && !cur.isKw("ORDER") && !cur.isKw("LIMIT")) cur.next();
    } else if (cur.isKw("LIMIT")) {
      cur.next();
      const t = cur.peek();
      if (t?.kind === "num") {
        limitN = Number.parseInt(t.value, 10);
        cur.next();
      }
    } else if (cur.isKw("OFFSET")) {
      warnings.push("OFFSET không lưu ở cấu hình nguồn dữ liệu — bỏ qua.");
      cur.next();
      if (cur.peek()?.kind === "num") cur.next();
    } else {
      cur.next(); // bỏ token lạ để tránh kẹt
    }
  }
  if (limitN != null) dsl.limit = limitN;

  // Compile DSL → config (tái dùng toàn bộ validate join/column/aggregate).
  const compiled = compileDataSourceDsl(dsl, entities);
  errors.push(...compiled.errors);
  warnings.push(...compiled.warnings);
  const config = compiled.config;

  // Gắn baseFilters.
  if (baseFilters && Object.keys(baseFilters).length > 0) {
    const baseEnt = byName.get(from.baseEntity.toLowerCase());
    for (const k of Object.keys(baseFilters)) {
      if (baseEnt && !baseEnt.fields.some((f) => f.name === k))
        warnings.push(`WHERE: field gốc "${k}" không tồn tại trên ${baseEnt.name}.`);
    }
    config.baseFilters = baseFilters;
  }

  // Gắn sort: key trỏ cột chiếu (fields[].key). Chấp nhận ORDER BY theo alias key
  // hoặc node.field (tra ngược ra key cột đã chiếu).
  if (orderBy) {
    const key = resolveSortKey(orderBy, config.fields, baseRefs);
    if (key) config.sort = { key, dir: orderBy.dir };
    else
      warnings.push(
        `ORDER BY "${orderBy.node ? `${orderBy.node}.` : ""}${orderBy.field}" bỏ qua — hãy SELECT cột đó (sort trỏ theo cột đã chọn).`,
      );
  }

  return { config, errors, warnings };
}

/** Map ORDER BY ref → fields[].key. Ưu tiên khớp key trực tiếp, rồi node.field. */
function resolveSortKey(
  ob: { node?: string; field: string },
  fields: DataSourceField[],
  baseRefs: Set<string>,
): string | undefined {
  // 1) khớp trực tiếp alias = key cột chiếu
  if (!ob.node) {
    const direct = fields.find((f) => f.key === ob.field);
    if (direct) return direct.key;
  }
  // 2) node.field → tìm cột chiếu cùng sourceField (+ đúng node nếu base)
  const wantBase = !ob.node || baseRefs.has(ob.node.toLowerCase());
  const m = fields.find(
    (f) => f.sourceField === ob.field && (wantBase ? f.sourceRelationId === "base" : true),
  );
  return m?.key;
}

/* ═══════════════════════ Config → SQL ═══════════════════════ */

export function dataSourceToSql(cfg: DataSourceConfig, entities: DslEntity[]): string {
  if (!cfg.baseEntityId) return "-- Chưa chọn đối tượng gốc.\nSELECT *\nFROM <đối tượng gốc> base";
  const dsl = decompileToDsl(cfg, entities);
  const byId = new Map(entities.map((e) => [e.id, e]));
  // Tham chiếu entity bằng TÊN KỸ THUẬT (ổn định qua đổi nhãn), fallback nhãn → id.
  const entRef = (eid: string): string => {
    const e = byId.get(eid);
    return e?.techName?.trim() || e?.name || eid;
  };
  const baseName = entRef(cfg.baseEntityId) || dsl.base || "base";

  // Alias node: base → "base"; relation → alias (đã unique trong cfg).
  const relById = new Map(cfg.relations.map((r) => [r.id, r]));
  const nodeAlias = (rid: string): string =>
    rid === "base" ? "base" : relById.get(rid)?.alias || rid;

  // SELECT list.
  const lines: string[] = [];
  for (const f of cfg.fields) {
    const ref = `${nodeAlias(f.sourceRelationId)}.${f.sourceField}`;
    // chỉ thêm AS khi key khác mặc định (base: field; join: alias_field).
    const def =
      f.sourceRelationId === "base"
        ? f.sourceField
        : `${nodeAlias(f.sourceRelationId)}_${f.sourceField}`;
    lines.push(f.key && f.key !== def ? `${ref} AS ${f.key}` : ref);
  }
  // Aggregate → subquery tương quan.
  for (const a of cfg.aggregates ?? []) {
    const childName = entRef(a.targetEntityId);
    const srcAlias = nodeAlias(a.sourceRelationId ?? "base");
    const matchField = a.matchField || "id";
    const fnArg = a.agg === "count" ? "*" : `c.${a.valueField ?? "*"}`;
    // N-N (via) — diễn đạt gần đúng bằng comment; engine vẫn chạy từ config.
    const viaNote = a.via ? ` /* N-N qua ${entRef(a.via.farEntityId)} */` : "";
    lines.push(
      `(SELECT ${a.agg.toUpperCase()}(${fnArg}) FROM ${childName} c WHERE c.${a.targetField} = ${srcAlias}.${matchField})${viaNote} AS ${a.key}`,
    );
  }
  if (lines.length === 0) lines.push("*");

  let sql = `SELECT\n  ${lines.join(",\n  ")}\nFROM ${baseName} base`;

  // JOINs (theo thứ tự cfg.relations; alias cha = nodeAlias).
  for (const r of cfg.relations) {
    const to = r.toField && r.toField !== "id" ? r.toField : "id";
    const parentAlias = nodeAlias(r.fromRelationId ?? "base");
    const childName = entRef(r.targetEntityId);
    const kw = r.joinKind === "inner" ? "INNER JOIN" : "LEFT JOIN";
    sql += `\n${kw} ${childName} ${r.alias} ON ${parentAlias}.${r.fromField} = ${r.alias}.${to}`;
  }

  // WHERE (baseFilters — field gốc).
  const bf = cfg.baseFilters ?? {};
  const conds = Object.entries(bf).map(([field, c]) => condToSql(`base.${field}`, c.op, c.value));
  if (conds.length) sql += `\nWHERE ${conds.join("\n  AND ")}`;

  // ORDER BY (sort.key → node.field cho dễ đọc, fallback key).
  if (cfg.sort?.key) {
    const f = cfg.fields.find((x) => x.key === cfg.sort?.key);
    const ref = f ? `${nodeAlias(f.sourceRelationId)}.${f.sourceField}` : cfg.sort.key;
    sql += `\nORDER BY ${ref} ${cfg.sort.dir.toUpperCase()}`;
  }

  // LIMIT.
  if (cfg.defaultLimit) sql += `\nLIMIT ${cfg.defaultLimit}`;

  // Computed — KHÔNG biểu diễn SQL được (formula layer). Giữ ở Cấu hình/DSL.
  if ((cfg.computed ?? []).length) {
    const names = (cfg.computed ?? []).map((c) => c.key).join(", ");
    sql = `-- Cột tính toán (formula, quản ở tab Cấu hình/DSL, giữ nguyên khi áp dụng SQL): ${names}\n${sql}`;
  }

  return sql;
}

function condToSql(lhs: string, op: FilterOp, value: unknown): string {
  const lit = (v: unknown): string =>
    typeof v === "number" ? String(v) : v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
  switch (op) {
    case "contains":
      return `${lhs} LIKE '%${String(value ?? "").replace(/'/g, "''")}%'`;
    case "in": {
      const arr = Array.isArray(value) ? value : [value];
      return `${lhs} IN (${arr.map(lit).join(", ")})`;
    }
    case "!=":
      return `${lhs} <> ${lit(value)}`;
    case "is-not-true":
      return `COALESCE(${lhs}::text, 'false') <> 'true'`;
    default:
      return `${lhs} ${op} ${lit(value)}`;
  }
}
