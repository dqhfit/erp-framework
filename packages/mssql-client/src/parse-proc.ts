/* ==========================================================
   parse-proc.ts — Phân tích heuristic body T-SQL.
   Không dùng T-SQL parser đầy đủ — chỉ cần:
     - tập bảng đọc / ghi
     - cặp cột JOIN (suy ra relation ẩn)
     - flag tính chất (transaction, CTE, window, GROUP BY, …)
   Output dùng cho generator sinh manifest YAML — HUMAN REVIEW
   trước khi sinh code, nên độ chính xác ~80% là đủ.
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

/** Trích alias map từ FROM/JOIN: alias → schema.table. */
export function extractAliasMap(sqlClean: string): Map<string, string> {
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
    // alias = alias riêng nếu có, nếu không dùng tên ngắn của bảng.
    if (aliasRaw) {
      const alias = normalizeIdent(aliasRaw);
      // Bỏ các keyword T-SQL bị nhầm là alias (vd "ON", "WHERE", "INNER"...).
      if (!isKeywordLike(alias)) map.set(alias, table);
    }
    const shortName = table.split(".").pop()!;
    if (!map.has(shortName)) map.set(shortName, table);
  }
  return map;
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

export function extractJoinPairs(sqlClean: string, aliases: Map<string, string>): JoinPair[] {
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
    const leftTable = aliases.get(leftAlias) ?? leftAlias;
    const rightTable = aliases.get(rightAlias) ?? rightAlias;
    pairs.push({ leftTable, leftColumn: leftCol, rightTable, rightColumn: rightCol });
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
  const aliases = extractAliasMap(clean);
  const readsTables = extractReads(clean);
  const writesTables = extractWrites(clean);
  const joinPairs = extractJoinPairs(clean, aliases);
  const callsProcs = extractExecCalls(clean);
  const flags = detectFlags(clean, writesTables, callsProcs);
  const suggestedTier = pickTier(flags, writesTables);
  return { readsTables, writesTables, joinPairs, callsProcs, flags, suggestedTier };
}
