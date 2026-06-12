/* ==========================================================
   cluster-datasource-procs.ts — Gom 275 proc nhóm query_datasource
   thành CỤM ứng viên DataSource: cùng bảng base + cùng tập bảng join
   → 1 DataSource đủ cột + N filter preset ở widget (pattern pilot
   ds_tonkho_vattu).

   Mỗi proc parse từ body T-SQL:
   - base   = bảng sau FROM đầu tiên (bảng thật, bỏ #temp).
   - joins  = các cạnh JOIN <bảng> ON a.x = b.y (resolve alias→bảng).
   - flags  = group-by/union/pivot/temp-table/cursor/while/cte/
              scalar-assign/dynamic-sql/write (re-check ghi).
   Cụm key = base + tập bảng join (sort). Proc có flag phức tạp rơi
   vào bucket "complex" (Tier D đọc / chờ DataSource groupBy);
   proc phát hiện GHI → bucket "reclassify-tierD".

   Chạy:
     node --import tsx tooling/migration-cli/src/cluster-datasource-procs.ts
   Input : migration-plan/ui/procs-query-datasource.txt + proc-bodies/*.sql
           + prod-entities-table.txt (entity tier=table có trên prod)
   Output: migration-plan/ui/datasource-clusters.json + tóm tắt stdout.
   ========================================================== */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const LIST = resolve(ROOT, "migration-plan", "ui", "procs-query-datasource.txt");
const BODIES = resolve(ROOT, "migration-plan", "ui", "proc-bodies");
const PROD_ENTITIES = resolve(ROOT, "migration-plan", "ui", "prod-entities-table.txt");
const OUT = resolve(ROOT, "migration-plan", "ui", "datasource-clusters.json");

function stripSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/N?'(?:[^']|'')*'/g, "''");
}

const norm = (t: string) =>
  t
    .replace(/[[\]]/g, "")
    .replace(/^dbo\./i, "")
    .toLowerCase();
const isTemp = (t: string) => t.startsWith("#") || t.startsWith("@");

interface JoinEdge {
  table: string;
  kind: "inner" | "left";
  on: string[];
}

interface ProcInfo {
  proc: string;
  base: string | null;
  joins: JoinEdge[];
  flags: string[];
}

const prodEntities = new Set(
  readFileSync(PROD_ENTITIES, "utf8")
    .split(/,\s*|\r?\n/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

const names = readFileSync(LIST, "utf8")
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);

const procs: ProcInfo[] = [];
const missingSource: string[] = [];

for (const name of names) {
  const file = resolve(BODIES, `${name.toLowerCase()}.sql`);
  if (!existsSync(file)) {
    missingSource.push(name);
    continue;
  }
  const raw = readFileSync(file, "utf8");
  const bodyStart = raw.search(/\bAS\b/i);
  const body = stripSql(bodyStart > 0 ? raw.slice(bodyStart) : raw);

  const flags = new Set<string>();

  // Re-check ghi (phòng phân loại kiểm kê cũ sai)
  const writeRe =
    /\b(INSERT\s+(INTO\s+)?(?![#@])|UPDATE\s+(?![#@])|DELETE\s+(FROM\s+)?(?![#@])|MERGE\s+|TRUNCATE\s+TABLE)/i;
  if (writeRe.test(body)) flags.add("write");
  if (/\bEXEC(?:UTE)?\s+(?!sp_executesql)[\w.[\]]/i.test(body)) flags.add("exec-proc");
  if (/sp_executesql/i.test(body)) flags.add("dynamic-sql");
  if (/\bGROUP\s+BY\b/i.test(body)) flags.add("group-by");
  if (/\bUNION\b/i.test(body)) flags.add("union");
  if (/\bPIVOT\b/i.test(body)) flags.add("pivot");
  if (/\bOVER\s*\(/i.test(body)) flags.add("window");
  if (/[#]\w+/.test(body)) flags.add("temp-table");
  if (/\bCURSOR\b/i.test(body)) flags.add("cursor");
  if (/\bWHILE\b/i.test(body)) flags.add("while");
  if (/\bWITH\s+\w+\s+AS\s*\(/i.test(body)) flags.add("cte");
  if (/\bSELECT\s+@\w+\s*=/i.test(body)) flags.add("scalar-assign");
  // Subquery trong WHERE/SELECT (IN (SELECT ...) / EXISTS) — DataSource chưa diễn đạt
  if (/\b(IN|EXISTS)\s*\(\s*SELECT\b/i.test(body)) flags.add("subquery");

  // alias → bảng (FROM/JOIN <bảng> [AS] <alias>)
  const aliasMap = new Map<string, string>();
  for (const m of body.matchAll(/\b(?:FROM|JOIN)\s+([\w.[\]#@]+)(?:\s+(?:AS\s+)?(\w+))?/gi)) {
    const tbl = m[1] ?? "";
    if (isTemp(tbl)) continue;
    const t = norm(tbl);
    const alias = (m[2] ?? "").toLowerCase();
    // alias trùng keyword (WHERE/ON/INNER...) → không phải alias
    if (
      alias &&
      !/^(where|on|inner|left|right|full|cross|join|group|order|having|union)$/.test(alias)
    ) {
      aliasMap.set(alias, t);
    }
    aliasMap.set(t, t); // tên bảng tự trỏ chính nó
  }

  // base = bảng sau FROM đầu tiên (bỏ FROM của subquery sâu — lấy match đầu)
  const baseM = body.match(/\bFROM\s+([\w.[\]#@]+)/i);
  const base = baseM && !isTemp(baseM[1] ?? "") ? norm(baseM[1] ?? "") : null;

  // joins: JOIN <bảng> [AS alias] ON <điều kiện đến AND/WHERE/JOIN kế>
  const joins: JoinEdge[] = [];
  for (const m of body.matchAll(
    /\b(LEFT(?:\s+OUTER)?|INNER|RIGHT(?:\s+OUTER)?)?\s*JOIN\s+([\w.[\]#@]+)(?:\s+(?:AS\s+)?(\w+))?\s+ON\s+([^]+?)(?=\b(?:LEFT|INNER|RIGHT|FULL|CROSS)?\s*JOIN\b|\bWHERE\b|\bGROUP\b|\bORDER\b|\bUNION\b|$)/gi,
  )) {
    const tbl = m[2] ?? "";
    if (isTemp(tbl)) continue;
    const kindRaw = (m[1] ?? "").toUpperCase();
    const on = (m[4] ?? "")
      .split(/\bAND\b/i)
      .map((s) => s.trim().replace(/\s+/g, " "))
      .filter(Boolean)
      .slice(0, 4);
    joins.push({
      table: norm(tbl),
      kind: kindRaw.startsWith("LEFT") ? "left" : "inner",
      on,
    });
  }

  procs.push({ proc: name, base, joins, flags: [...flags].sort() });
}

/* ── Phân bucket ── */
const COMPLEX_FLAGS = [
  "group-by",
  "union",
  "pivot",
  "window",
  "temp-table",
  "cursor",
  "while",
  "cte",
  "scalar-assign",
  "dynamic-sql",
  "exec-proc",
  "subquery",
];

interface Cluster {
  key: string;
  base: string;
  joinTables: string[];
  joinEdges: Record<string, { kind: string; on: string[] }>;
  procs: string[];
  missingEntities: string[];
  suggestedName: string;
}

const writeProcs = procs.filter((p) => p.flags.includes("write"));
const complexProcs = procs.filter(
  (p) => !p.flags.includes("write") && p.flags.some((f) => COMPLEX_FLAGS.includes(f)),
);
const simpleProcs = procs.filter(
  (p) => !p.flags.includes("write") && !p.flags.some((f) => COMPLEX_FLAGS.includes(f)),
);

const clusters = new Map<string, Cluster>();
for (const p of simpleProcs) {
  if (!p.base) continue;
  const joinTables = [...new Set(p.joins.map((j) => j.table))].sort();
  const key = `${p.base}|${joinTables.join(",")}`;
  let c = clusters.get(key);
  if (!c) {
    const allTables = [p.base, ...joinTables];
    c = {
      key,
      base: p.base,
      joinTables,
      joinEdges: {},
      procs: [],
      missingEntities: allTables.filter((t) => !prodEntities.has(t)),
      suggestedName: `ds_${p.base.replace(/^tr_|^dqt_|^trtb_/, "")}${joinTables.length > 0 ? "_full" : ""}`,
    };
    clusters.set(key, c);
  }
  c.procs.push(p.proc);
  for (const j of p.joins) {
    if (!c.joinEdges[j.table]) c.joinEdges[j.table] = { kind: j.kind, on: j.on };
  }
}

const sorted = [...clusters.values()].sort((a, b) => b.procs.length - a.procs.length);

writeFileSync(
  OUT,
  JSON.stringify(
    {
      counts: {
        total: names.length,
        simple: simpleProcs.length,
        complex: complexProcs.length,
        write: writeProcs.length,
        missingSource: missingSource.length,
        clusters: sorted.length,
      },
      clusters: sorted,
      complexProcs: complexProcs.map((p) => ({ proc: p.proc, base: p.base, flags: p.flags })),
      writeProcs: writeProcs.map((p) => p.proc),
      missingSource,
    },
    null,
    1,
  ),
  "utf8",
);

console.log("=== CLUSTER 275 proc query_datasource ===");
console.log(`đọc đơn giản (DS được): ${simpleProcs.length} → ${sorted.length} cụm`);
console.log(`đọc phức tạp (Tier D đọc / chờ DS groupBy): ${complexProcs.length}`);
console.log(`có GHI (reclassify Tier D): ${writeProcs.length}`);
console.log(`thiếu source MSSQL: ${missingSource.length}`);
console.log(`\nChi tiết: ${OUT}\n`);
console.log("--- TOP cụm theo số proc ---");
for (const c of sorted.slice(0, 25)) {
  const miss = c.missingEntities.length > 0 ? `  ⚠thiếu: ${c.missingEntities.join(",")}` : "";
  console.log(
    `${c.suggestedName}  [${c.base}${c.joinTables.length ? " + " + c.joinTables.join(",") : ""}]  ${c.procs.length} proc${miss}`,
  );
}
