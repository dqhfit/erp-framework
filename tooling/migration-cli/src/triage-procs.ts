/* ==========================================================
   triage-procs.ts — Phân loại proc write_logic còn lại theo body T-SQL:
   proc CHỈ ĐỌC → ứng viên chuyển DataSource (không cần code Tier D);
   proc CÓ GHI → tiếp tục port Tier D (procTable).

   Heuristic trên body đã strip comment/string:
   - Ghi bảng THẬT (không phải #temp): INSERT INTO x / UPDATE x /
     DELETE x / MERGE x / SELECT ... INTO x / TRUNCATE / EXEC proc
     → nhóm "tierD" (kèm cờ multiWrite/exec).
   - Không ghi → "datasource" nếu SELECT phẳng (join + where);
     "datasource-aggregate" nếu có GROUP BY/UNION/PIVOT/OVER()/
     temp table/cursor/WHILE/CTE — DataSource hiện chưa diễn đạt nổi,
     cần Tier D đọc hoặc mở rộng DataSource groupBy server-side.

   Chạy:
     node --import tsx tooling/migration-cli/src/triage-procs.ts
   Input : migration-plan/ui/procs-remaining.txt + proc-bodies/*.sql
   Output: migration-plan/ui/procs-triage.json + tóm tắt stdout.
   ========================================================== */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const REMAINING = resolve(ROOT, "migration-plan", "ui", "procs-remaining.txt");
const BODIES = resolve(ROOT, "migration-plan", "ui", "proc-bodies");
const OUT = resolve(ROOT, "migration-plan", "ui", "procs-triage.json");

/** Bỏ comment + string literal để keyword scan không dính nhiễu. */
function stripSql(sql: string): string {
  return (
    sql
      // block comment (không lồng — đủ cho T-SQL thực tế)
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      // line comment
      .replace(/--[^\n]*/g, " ")
      // string N'..' / '..' (giữ chỗ trống)
      .replace(/N?'(?:[^']|'')*'/g, "''")
  );
}

interface Triage {
  proc: string;
  group:
    | "datasource"
    | "datasource-aggregate"
    | "tierD"
    | "tierD-read-scalar"
    | "tierB-pure-calc"
    | "missing-source";
  writes: string[];
  reads: string[];
  flags: string[];
}

/** Override tay sau khi review thủ công — heuristic không bắt được. */
const OVERRIDES: Record<string, { group: Triage["group"]; reads?: string[]; note?: string }> = {
  // Dynamic SQL (sp_executesql) giấu bảng đọc khỏi heuristic: thực chất
  // SELECT join tr_tonkho_sum + tr_material với filter điều kiện — datasource-fit.
  TR_TONKHO_SUM_GETALL3: { group: "datasource", reads: ["tr_material", "tr_tonkho_sum"] },
};

const names = readFileSync(REMAINING, "utf8")
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);

const results: Triage[] = [];

for (const name of names) {
  const file = resolve(BODIES, `${name.toLowerCase()}.sql`);
  if (!existsSync(file)) {
    results.push({ proc: name, group: "missing-source", writes: [], reads: [], flags: [] });
    continue;
  }
  const raw = readFileSync(file, "utf8");
  // Bỏ phần PARAMS header của dump + header CREATE PROC (tên proc chứa
  // INSERT/UPDATE/DELETE sẽ false-positive nếu không bỏ).
  const bodyStart = raw.search(/\bAS\b/i);
  const body = stripSql(bodyStart > 0 ? raw.slice(bodyStart) : raw);

  const writes = new Set<string>();
  const flags = new Set<string>();
  const reads = new Set<string>();

  const isTemp = (t: string) => t.startsWith("#") || t.startsWith("@");
  const norm = (t: string) =>
    t
      .replace(/[[\]]/g, "")
      .replace(/^dbo\./i, "")
      .toLowerCase();

  // Bảng đích các câu ghi
  for (const m of body.matchAll(/\bINSERT\s+(?:INTO\s+)?([#@\w.[\]]+)/gi)) {
    const t = norm(m[1] ?? "");
    if (t && !isTemp(m[1] ?? "")) writes.add(t);
  }
  for (const m of body.matchAll(/\bUPDATE\s+([#@\w.[\]]+)/gi)) {
    const t = norm(m[1] ?? "");
    if (t && !isTemp(m[1] ?? "")) writes.add(t);
  }
  for (const m of body.matchAll(/\bDELETE\s+(?:FROM\s+)?([#@\w.[\]]+)/gi)) {
    const t = norm(m[1] ?? "");
    if (t && !isTemp(m[1] ?? "")) writes.add(t);
  }
  for (const m of body.matchAll(/\bMERGE\s+(?:INTO\s+)?([#@\w.[\]]+)/gi)) {
    const t = norm(m[1] ?? "");
    if (t && !isTemp(m[1] ?? "")) writes.add(t);
  }
  for (const m of body.matchAll(/\bINTO\s+([^#@\s,()]+)/gi)) {
    // SELECT ... INTO bảng thật (INSERT INTO đã bắt ở trên — INTO sau SELECT)
    const prefix = body.slice(Math.max(0, (m.index ?? 0) - 12), m.index ?? 0);
    if (/INSERT\s*$/i.test(prefix)) continue;
    const t = norm(m[1] ?? "");
    if (t && !isTemp(m[1] ?? "")) writes.add(t);
  }
  if (/\bTRUNCATE\s+TABLE\b/i.test(body)) flags.add("truncate");
  if (/\bEXEC(?:UTE)?\s+(?!sp_executesql)[\w.[\]]/i.test(body)) flags.add("exec-proc");

  // Bảng đọc (FROM/JOIN) — để gợi ý base entity cho datasource
  for (const m of body.matchAll(/\b(?:FROM|JOIN)\s+([#@\w.[\]]+)/gi)) {
    const t = m[1] ?? "";
    if (!isTemp(t)) reads.add(norm(t));
  }

  // Cờ phức tạp cho read
  if (/\bGROUP\s+BY\b/i.test(body)) flags.add("group-by");
  if (/\bUNION\b/i.test(body)) flags.add("union");
  if (/\bPIVOT\b/i.test(body)) flags.add("pivot");
  if (/\bOVER\s*\(/i.test(body)) flags.add("window");
  if (/[#]\w+/.test(body)) flags.add("temp-table");
  if (/\bCURSOR\b/i.test(body)) flags.add("cursor");
  if (/\bWHILE\b/i.test(body)) flags.add("while");
  if (/\bWITH\s+\w+\s+AS\s*\(/i.test(body)) flags.add("cte");

  // SELECT @x = ... (gán biến/OUTPUT param) → proc trả SCALAR, không phải
  // dataset — DataSource không thay được, nhưng Tier D rất mỏng.
  if (/\bSELECT\s+@\w+\s*=/i.test(body) || /\bSET\s+@\w+\s*=/i.test(body)) {
    flags.add("scalar-assign");
  }

  const hasWrite = writes.size > 0 || flags.has("truncate") || flags.has("exec-proc");
  const complexRead = [
    "group-by",
    "union",
    "pivot",
    "window",
    "temp-table",
    "cursor",
    "while",
    "cte",
  ].some((f) => flags.has(f));

  let group: Triage["group"];
  if (hasWrite) group = "tierD";
  else if (reads.size === 0)
    group = "tierB-pure-calc"; // thuần công thức, không đụng bảng
  else if (flags.has("scalar-assign")) group = "tierD-read-scalar";
  else if (complexRead) group = "datasource-aggregate";
  else group = "datasource";

  const ovr = OVERRIDES[name];
  results.push({
    proc: name,
    group: ovr?.group ?? group,
    writes: [...writes].sort(),
    reads: ovr?.reads ?? [...reads].sort(),
    flags: [...flags].sort(),
  });
}

const counts: Record<string, number> = {};
for (const r of results) counts[r.group] = (counts[r.group] ?? 0) + 1;

writeFileSync(OUT, JSON.stringify({ counts, results }, null, 1), "utf8");

console.log("=== TRIAGE 101 proc write_logic còn lại ===");
for (const [g, n] of Object.entries(counts)) console.log(`${g}: ${n}`);
console.log(`\nChi tiết: ${OUT}`);
for (const g of [
  "datasource",
  "datasource-aggregate",
  "tierD-read-scalar",
  "tierB-pure-calc",
  "missing-source",
] as const) {
  const list = results.filter((r) => r.group === g);
  if (list.length === 0) continue;
  console.log(`\n--- ${g} (${list.length}) ---`);
  for (const r of list) console.log(`${r.proc}  [đọc: ${r.reads.join(",") || "-"}]`);
}
