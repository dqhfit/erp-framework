/* ==========================================================
   parse-proc.ts — Phân tích heuristic body T-SQL.
   Không dùng T-SQL parser đầy đủ — chỉ cần:
     - tập bảng đọc / ghi
     - cặp cột JOIN (suy ra relation ẩn)
     - flag tính chất (transaction, CTE, window, GROUP BY, …)
   Output dùng cho generator sinh manifest YAML — HUMAN REVIEW
   trước khi sinh code, nên độ chính xác ~80% là đủ.

   Hỗ trợ trace qua bảng tạm:
     - CTE: extract body, map alias → CTE name → permanent tables
     - #tmp / @var: trace SELECT INTO / INSERT INTO để tìm nguồn
   ========================================================== */

import type { JoinPair, ProcAnalysis, ProcFlag } from "./types.js";

/** Strip comment và string literal để regex không dính false-positive. */
export function stripCommentsAndStrings(sqlText: string): string {
  let out = "";
  let i = 0;
  while (i < sqlText.length) {
    const ch = sqlText[i];
    const next = sqlText[i + 1];
    // -- line comment
    if (ch === "-" && next === "-") {
      const nl = sqlText.indexOf("\n", i);
      if (nl < 0) break;
      out += " ".repeat(nl - i);
      i = nl;
      continue;
    }
    // block comment (không support nested cho gọn — T-SQL hiểu nested
    // nhưng 99% proc không viết nested)
    if (ch === "/" && next === "*") {
      const end = sqlText.indexOf("*/", i + 2);
      if (end < 0) {
        out += " ".repeat(sqlText.length - i);
        break;
      }
      out += " ".repeat(end + 2 - i);
      i = end + 2;
      continue;
    }
    // 'string' (with '' escape)
    if (ch === "'") {
      let j = i + 1;
      while (j < sqlText.length) {
        if (sqlText[j] === "'" && sqlText[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sqlText[j] === "'") {
          j++;
          break;
        }
        j++;
      }
      out += " ".repeat(j - i);
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Bọc [bracket] / "quote" khỏi identifier và lower-case. */
function normalizeIdent(raw: string): string {
  return raw.replace(/^\[/, "").replace(/]$/, "").replace(/^"/, "").replace(/"$/, "").toLowerCase();
}

/** Bởi schema.table — nếu không có schema, gán "dbo." mặc định. */
function qualify(name: string): string {
  const parts = name.split(".").map(normalizeIdent).filter(Boolean);
  if (parts.length === 1) return `dbo.${parts[0]}`;
  return parts.slice(-2).join(".");
}

/** Tập bảng temp + table variable bỏ qua (không phải bảng nghiệp vụ). */
function isTransient(name: string): boolean {
  const last = name.split(".").pop() ?? "";
  return last.startsWith("#") || last.startsWith("@");
}

/** Regex match identifier T-SQL: [..] | "..." | unquoted (.unquoted)*. */
const IDENT = `(?:\\[[^\\]]+\\]|"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)`;
const QNAME = `(?:${IDENT}(?:\\s*\\.\\s*${IDENT}){0,2})`;

/** Extract tên bảng permanent từ một đoạn SQL con (dùng lại cho CTE body + temp source). */
function extractPermanentTablesFrom(sql: string): string[] {
  const set = new Set<string>();
  const re = new RegExp(`\\b(?:from|join)\\s+(${QNAME})`, "gi");
  for (const m of sql.matchAll(re)) {
    if (!m[1]) continue;
    const t = qualify(m[1]);
    if (!isTransient(t)) set.add(t);
  }
  return [...set];
}

/** Trích map CTE: cteName (lowercase) → [permanent tables in body].
 *
 *  Dùng bracket counting để tìm body chính xác — tránh bị lừa bởi SELECT
 *  bên trong CTE body. Xử lý: multi-CTE, column list `name(c1,c2) AS (...)`.
 *
 *  Lưu ý: CTE lồng nhau tham chiếu CTE khác (b AS (SELECT FROM a)) → sources
 *  của b là [] vì `a` không phải real table — safe, không tạo hint sai. */
export function extractCteMap(sqlClean: string): Map<string, string[]> {
  const map = new Map<string, string[]>();

  const withMatch = /\bwith\b/i.exec(sqlClean);
  if (!withMatch) return map;

  let pos = withMatch.index + withMatch[0].length;

  // Parse comma-separated CTE definitions: name [(cols)] AS (body)
  while (pos < sqlClean.length) {
    // Skip whitespace
    const ws = /^\s+/.exec(sqlClean.slice(pos));
    if (ws) pos += ws[0].length;

    // Match: identifier [(optional column list)] AS (
    const nameMatch = /^(\w+)\s*(?:\([^)]*\)\s*)?as\s*\(/i.exec(sqlClean.slice(pos));
    if (!nameMatch) break;

    const cteName = (nameMatch[1] ?? "").toLowerCase();
    if (!cteName) break;
    // Move to position of the opening '(' (last char of nameMatch[0])
    pos += nameMatch[0].length - 1;

    // Bracket counting to find matching ')'
    let depth = 0;
    const bodyStart = pos + 1;
    let bodyEnd = pos;
    for (let i = pos; i < sqlClean.length; i++) {
      if (sqlClean[i] === "(") depth++;
      else if (sqlClean[i] === ")") {
        depth--;
        if (depth === 0) {
          bodyEnd = i;
          break;
        }
      }
    }
    if (bodyEnd <= bodyStart) break;

    const body = sqlClean.slice(bodyStart, bodyEnd);
    map.set(cteName, extractPermanentTablesFrom(body));

    pos = bodyEnd + 1;

    // Continue if there's another CTE (comma separator)
    const comma = /^\s*,\s*/.exec(sqlClean.slice(pos));
    if (comma) {
      pos += comma[0].length;
    } else {
      break;
    }
  }

  return map;
}

/** Track nguồn permanent table của mỗi #tmp được tạo trong cùng proc.
 *
 *  Pattern 1: SELECT [...] INTO #tmp FROM table1 JOIN table2 ...
 *  Pattern 2: INSERT INTO #tmp [...] SELECT [...] FROM table1 ...
 *
 *  Trả Map: #tmpName (lowercase) → [permanent source tables]. */
export function extractTempSources(sqlClean: string): Map<string, string[]> {
  const map = new Map<string, string[]>();

  const addSources = (tmpName: string, sql: string) => {
    const tables = extractPermanentTablesFrom(sql);
    if (tables.length === 0) return;
    const existing = map.get(tmpName) ?? [];
    map.set(tmpName, [...new Set([...existing, ...tables])]);
  };

  // Pattern 1: SELECT [...] INTO #tmp (FROM comes after INTO #tmp in ~600 chars)
  const selectIntoRe = /\binto\s+(#\w+)\b/gi;
  for (const m of sqlClean.matchAll(selectIntoRe)) {
    if (!m[1]) continue;
    const tmpName = m[1].toLowerCase();
    const afterPos = (m.index ?? 0) + m[0].length;
    const chunk = sqlClean.slice(afterPos, afterPos + 600);
    // FROM clause ends at WHERE / GROUP BY / ORDER BY / next statement keyword
    const fromMatch =
      /\bfrom\b([\s\S]+?)(?=\bwhere\b|\bgroup\s+by\b|\border\s+by\b|\bhaving\b|\b(?:insert|update|delete|merge|exec(?:ute)?|create|drop|select)\b|$)/i.exec(
        chunk,
      );
    if (fromMatch) addSources(tmpName, `FROM ${fromMatch[1]}`);
  }

  // Pattern 2: INSERT INTO #tmp [(...)] SELECT [...] FROM [...]
  const insertIntoRe = /\binsert\s+into\s+(#\w+)\b/gi;
  for (const m of sqlClean.matchAll(insertIntoRe)) {
    if (!m[1]) continue;
    const tmpName = m[1].toLowerCase();
    const afterPos = (m.index ?? 0) + m[0].length;
    const chunk = sqlClean.slice(afterPos, afterPos + 1000);
    const fromMatch =
      /\bfrom\b([\s\S]+?)(?=\bwhere\b|\bgroup\s+by\b|\border\s+by\b|\bhaving\b|\b(?:insert|update|delete|merge|exec(?:ute)?|create|drop)\b|;|$)/i.exec(
        chunk,
      );
    if (fromMatch) addSources(tmpName, `FROM ${fromMatch[1]}`);
  }

  return map;
}

/** Trích alias map từ FROM/JOIN: alias → schema.table.
 *
 *  cteNames: tập CTE name để bỏ qua (không phải bảng thật). */
export function extractAliasMap(
  sqlClean: string,
  cteNames: Set<string> = new Set(),
): Map<string, string> {
  const map = new Map<string, string>();
  // FROM/JOIN <qname> [AS] <alias>
  const re = new RegExp(`\\b(?:from|join)\\s+(${QNAME})(?:\\s+(?:as\\s+)?(${IDENT}))?`, "gi");
  for (const m of sqlClean.matchAll(re)) {
    const tableRaw = m[1];
    const aliasRaw = m[2];
    if (!tableRaw) continue;
    // Bỏ qua subquery — table luôn bắt đầu bằng '(' trước đó, regex không
    // capture (do FROM (SELECT ..) không khớp). Vậy nếu khớp là table thật.
    const table = qualify(tableRaw);
    if (isTransient(table)) continue;
    // Bỏ CTE name — không phải real table
    const shortName = table.split(".").pop()!.toLowerCase();
    if (cteNames.has(shortName)) continue;
    // alias = alias riêng nếu có, nếu không dùng tên ngắn của bảng.
    if (aliasRaw) {
      const alias = normalizeIdent(aliasRaw);
      // Bỏ các keyword T-SQL bị nhầm là alias (vd "ON", "WHERE", "INNER"...).
      if (!isKeywordLike(alias)) map.set(alias, table);
    }
    if (!map.has(shortName)) map.set(shortName, table);
  }
  return map;
}

/** Build map: CTE alias (và tên ngắn CTE) → cteName để dùng khi resolve joinPairs. */
function buildCteAliasMap(sqlClean: string, cteMap: Map<string, string[]>): Map<string, string> {
  const map = new Map<string, string>(); // alias → cteName
  const re = new RegExp(`\\b(?:from|join)\\s+(${QNAME})(?:\\s+(?:as\\s+)?(${IDENT}))?`, "gi");
  for (const m of sqlClean.matchAll(re)) {
    const tableRaw = m[1];
    const aliasRaw = m[2];
    if (!tableRaw) continue;
    const shortTable = normalizeIdent(tableRaw.split(".").pop() ?? tableRaw);
    if (!cteMap.has(shortTable)) continue;
    map.set(shortTable, shortTable);
    if (aliasRaw) {
      const alias = normalizeIdent(aliasRaw);
      if (!isKeywordLike(alias)) map.set(alias, shortTable);
    }
  }
  return map;
}

/** Build map: temp table alias → #tmpName để dùng khi resolve joinPairs.
 *
 *  Ví dụ: "JOIN #active t ON ..." → {"t": "#active", "#active": "#active"}.
 *  Chỉ track các #tmp đã có trong tempMap (có biết nguồn). */
function buildTempAliasMap(sqlClean: string): Map<string, string> {
  const map = new Map<string, string>(); // alias → #tmpName
  // Tìm FROM/JOIN #tmpName [AS] alias
  const re = new RegExp(`\\b(?:from|join)\\s+(#\\w+)(?:\\s+(?:as\\s+)?(${IDENT}))?`, "gi");
  for (const m of sqlClean.matchAll(re)) {
    const tmpRaw = m[1];
    const aliasRaw = m[2];
    if (!tmpRaw) continue;
    const tmpName = tmpRaw.toLowerCase();
    // Map cả tên #tmp chưa biết nguồn (sẽ resolve về [] nhưng không fallback về alias string)
    map.set(tmpName, tmpName);
    if (aliasRaw) {
      const alias = normalizeIdent(aliasRaw);
      if (!isKeywordLike(alias)) map.set(alias, tmpName);
    }
  }
  return map;
}

/** Resolve 1 alias → {tables: permanent table names, via: trace string nếu gián tiếp}.
 *
 *  Priority: CTE alias → temp table alias → regular alias → fallback. */
function resolveToTables(
  alias: string,
  aliases: Map<string, string>,
  cteAliasMap: Map<string, string>,
  cteMap: Map<string, string[]>,
  tempAliasMap: Map<string, string>,
  tempMap: Map<string, string[]>,
): { tables: string[]; via?: string } {
  // 1. CTE alias → expand to CTE's permanent sources
  const cteName = cteAliasMap.get(alias);
  if (cteName) {
    const sources = cteMap.get(cteName) ?? [];
    return { tables: sources, via: `cte:${cteName}` };
  }

  // 2. Temp table alias → expand to temp's permanent sources
  const tmpName = tempAliasMap.get(alias);
  if (tmpName) {
    const sources = tempMap.get(tmpName) ?? [];
    return { tables: sources, via: `tmp:${tmpName}` };
  }

  // 3. Direct transient reference (alias starts with #/@)
  if (alias.startsWith("#") || alias.startsWith("@")) {
    const sources = tempMap.get(alias) ?? [];
    return { tables: sources, via: `tmp:${alias}` };
  }

  // 4. Regular permanent table
  const resolved = aliases.get(alias);
  if (resolved) return { tables: [resolved] };

  // 5. Fallback (unresolved alias — won't match entity, filtered server-side)
  return { tables: [alias] };
}

const ALIAS_KEYWORDS = new Set([
  "on",
  "where",
  "inner",
  "left",
  "right",
  "outer",
  "full",
  "cross",
  "join",
  "group",
  "order",
  "having",
  "union",
  "with",
  "for",
  "into",
  "set",
  "values",
  "as",
  "by",
  "and",
  "or",
  "not",
]);
function isKeywordLike(s: string): boolean {
  return ALIAS_KEYWORDS.has(s);
}

export function extractReads(sqlClean: string): string[] {
  const set = new Set<string>();
  const re = new RegExp(`\\b(?:from|join)\\s+(${QNAME})`, "gi");
  for (const m of sqlClean.matchAll(re)) {
    if (!m[1]) continue;
    const t = qualify(m[1]);
    if (!isTransient(t)) set.add(t);
  }
  return [...set].sort();
}

export function extractWrites(sqlClean: string): string[] {
  const set = new Set<string>();
  // INSERT bắt buộc INTO — nếu không, regex backtrack sẽ match "INTO" làm ident.
  // DELETE/MERGE: đặt optional FROM/INTO nhưng lọc keyword ở cuối.
  const patterns = [
    `\\binsert\\s+into\\s+(${QNAME})`,
    `\\bupdate\\s+(${QNAME})`,
    `\\bdelete\\s+(?:from\\s+)?(${QNAME})`,
    `\\bmerge\\s+(?:into\\s+)?(${QNAME})`,
  ];
  for (const p of patterns) {
    for (const m of sqlClean.matchAll(new RegExp(p, "gi"))) {
      if (!m[1]) continue;
      const t = qualify(m[1]);
      if (!isTransient(t)) set.add(t);
    }
  }
  return [...set].sort();
}

export function extractJoinPairs(
  sqlClean: string,
  aliases: Map<string, string>,
  cteAliasMap: Map<string, string> = new Map(),
  cteMap: Map<string, string[]> = new Map(),
  tempAliasMap: Map<string, string> = new Map(),
  tempMap: Map<string, string[]> = new Map(),
): JoinPair[] {
  const pairs: JoinPair[] = [];
  // ON <ident>.<ident> = <ident>.<ident>  — chấp nhận brackets / quoted.
  const re = new RegExp(
    `\\bon\\s+(${IDENT})\\s*\\.\\s*(${IDENT})\\s*=\\s*(${IDENT})\\s*\\.\\s*(${IDENT})`,
    "gi",
  );
  for (const m of sqlClean.matchAll(re)) {
    if (!m[1] || !m[2] || !m[3] || !m[4]) continue;
    const leftAlias = normalizeIdent(m[1]);
    const leftCol = normalizeIdent(m[2]);
    const rightAlias = normalizeIdent(m[3]);
    const rightCol = normalizeIdent(m[4]);

    const left = resolveToTables(leftAlias, aliases, cteAliasMap, cteMap, tempAliasMap, tempMap);
    const right = resolveToTables(rightAlias, aliases, cteAliasMap, cteMap, tempAliasMap, tempMap);

    for (const lt of left.tables) {
      for (const rt of right.tables) {
        if (lt === rt) continue;
        const pair: JoinPair = {
          leftTable: lt,
          leftColumn: leftCol,
          rightTable: rt,
          rightColumn: rightCol,
        };
        // Ghi lại nguồn trace khi suy luận gián tiếp qua CTE/tmp
        if (left.via ?? right.via) {
          pair.via = left.via ?? right.via;
        }
        pairs.push(pair);
      }
    }
  }
  return pairs;
}

export function extractExecCalls(sqlClean: string): string[] {
  const set = new Set<string>();
  // EXEC[UTE]? <qname>  — bỏ qua sp_executesql và EXEC('...').
  const re = new RegExp(`\\bexec(?:ute)?\\s+(${QNAME})\\b`, "gi");
  for (const m of sqlClean.matchAll(re)) {
    if (!m[1]) continue;
    const n = qualify(m[1]);
    const short = n.split(".").pop()!;
    if (short === "sp_executesql") continue;
    set.add(n);
  }
  return [...set].sort();
}

export function detectFlags(sqlClean: string, writes: string[], execs: string[]): ProcFlag[] {
  const f = new Set<ProcFlag>();
  if (
    /\bbegin\s+tran(?:saction)?\b/i.test(sqlClean) ||
    /\bcommit\s+tran(?:saction)?\b/i.test(sqlClean) ||
    /\brollback\s+tran(?:saction)?\b/i.test(sqlClean)
  ) {
    f.add("has-transaction");
  }
  if (/\bbegin\s+try\b/i.test(sqlClean)) f.add("has-try-catch");
  if (/\bdeclare\s+\S+\s+cursor\b/i.test(sqlClean) || /\bopen\s+\S+\s*$/im.test(sqlClean)) {
    f.add("has-cursor");
  }
  if (/\bwhile\s+/i.test(sqlClean)) f.add("has-while");
  if (/\bwith\s+\w+\s+as\s*\(/i.test(sqlClean)) f.add("has-cte");
  if (/\bgroup\s+by\b/i.test(sqlClean)) f.add("has-group-by");
  if (/\bover\s*\(/i.test(sqlClean)) f.add("has-window");
  if (/\bmerge\s+(?:into\s+)?\w/i.test(sqlClean)) f.add("has-merge");
  if (/#\w+/.test(sqlClean)) f.add("has-temp-table");
  if (execs.length > 0) f.add("calls-other-proc");
  if (writes.length > 1) f.add("writes-multi-table");
  if (/\bsp_executesql\b/i.test(sqlClean) || /\bexec\s*\(/i.test(sqlClean)) {
    f.add("dynamic-sql");
  }
  return [...f];
}

/** Quy tắc chọn tier: D nếu có bất kỳ dấu hiệu phức tạp, nếu không B. */
export function pickTier(flags: ProcFlag[], writes: string[]): "B" | "C" | "D" {
  const heavy: ProcFlag[] = [
    "has-transaction",
    "has-try-catch",
    "has-cte",
    "has-window",
    "has-group-by",
    "has-merge",
    "has-cursor",
    "dynamic-sql",
    "writes-multi-table",
  ];
  if (flags.some((x) => heavy.includes(x))) return "D";
  if (writes.length === 0) return "B"; // pure read — có thể là report nhỏ hoặc lookup
  return "B";
}

/** Entry chính: phân tích 1 proc body. */
export function analyzeProc(body: string): ProcAnalysis {
  const clean = stripCommentsAndStrings(body);
  const cteMap = extractCteMap(clean);
  const tempMap = extractTempSources(clean);
  const cteNames = new Set(cteMap.keys());
  const aliases = extractAliasMap(clean, cteNames);
  const cteAliasMap = buildCteAliasMap(clean, cteMap);
  const tempAliasMap = buildTempAliasMap(clean);
  const readsTables = extractReads(clean);
  const writesTables = extractWrites(clean);
  const joinPairs = extractJoinPairs(clean, aliases, cteAliasMap, cteMap, tempAliasMap, tempMap);
  const callsProcs = extractExecCalls(clean);
  const flags = detectFlags(clean, writesTables, callsProcs);
  const suggestedTier = pickTier(flags, writesTables);
  return { readsTables, writesTables, joinPairs, callsProcs, flags, suggestedTier };
}
