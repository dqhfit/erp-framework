/* ==========================================================
   diagnose-join-keys.mts — Đo tỉ lệ KHỚP của từng relation DataSource.
   Join key codegen có thể SAI (fromField≠toField thực) → cột join null
   hàng loạt dù base row hiện. Với mỗi relation (base.fromField = target.toField):
     matchRate = (số giá trị fromField DISTINCT của base CÓ trong toField target)
                 / (số giá trị fromField DISTINCT của base)
   matchRate thấp (<10%) → KEY SAI (cờ đỏ); 10-60% → nghi; >60% → ổn.

   Map field→cột vật lý qua meta.storage.columns (typed col f_xxx hoặc ext->>).
   Output: migration-plan/ui/join-key-report.json + stdout.
   Chạy (cwd packages/server):
     MIGRATION_MCP_KEY=... npx tsx ../../tooling/ui-migration/diagnose-join-keys.mts
   ========================================================== */
import { writeFileSync } from "node:fs";
import { join as pjoin } from "node:path";

const ERP_ROOT = "D:/code/cowok/Apps/erp-framework";
const MCP_URL = process.env.MIGRATION_MCP_URL ?? "https://erp.vfmgroup.vn/mcp/migration";
const KEY = process.env.MIGRATION_MCP_KEY ?? "";
if (!KEY) {
  console.error("Thiếu MIGRATION_MCP_KEY");
  process.exit(1);
}

let rpc = 0;
async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "X-API-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++rpc,
      method: "tools/call",
      params: { name: "migration_query_readonly", arguments: { sql } },
    }),
  });
  const j = (await res.json()) as { result?: { content?: Array<{ text?: string }> }; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  const o = JSON.parse(j.result?.content?.[0]?.text ?? "{}") as { rows?: T[] };
  return o.rows ?? [];
}

// field → biểu thức cột vật lý (typed col hoặc ext->>'field') cho 1 entity.
function colExpr(storage: { columns?: Record<string, { col: string }> }, field: string, alias: string) {
  const m = storage.columns?.[field];
  return m ? `${alias}."${m.col}"::text` : `(${alias}.ext->>'${field}')`;
}

async function main() {
  // 1. Relation thô (không join entities — tránh lỗi precedence lateral+JOIN).
  const rels = await query<{
    ds: string;
    baseId: string;
    fromField: string;
    targetId: string;
    toField: string;
    kind: string;
  }>(
    `SELECT d.name AS ds, d.config->>'baseEntityId' AS "baseId",
       r->>'fromField' AS "fromField", r->>'targetEntityId' AS "targetId",
       r->>'toField' AS "toField", r->>'joinKind' AS kind
     FROM datasources d, jsonb_array_elements(d.config->'relations') r
     WHERE r->>'fromField' IS NOT NULL AND r->>'toField' IS NOT NULL`,
  );

  // 2. storage (name + tableName + columns) cho mọi entity liên quan.
  const entIds = [...new Set(rels.flatMap((r) => [r.baseId, r.targetId]))];
  const storRows = await query<{ id: string; name: string; tbl: string; cols: string }>(
    `SELECT id, name, meta->'storage'->>'tableName' AS tbl,
       COALESCE((meta->'storage'->'columns')::text, '{}') AS cols
     FROM entities WHERE id IN (${entIds.map((i) => `'${i}'::uuid`).join(",")})`,
  );
  const storById = new Map(
    storRows.map((s) => [
      s.id,
      { name: s.name, tableName: s.tbl, columns: JSON.parse(s.cols) as Record<string, { col: string }> },
    ]),
  );
  const nm = (id: string) => storById.get(id)?.name ?? id.slice(0, 8);

  const report: Array<{
    ds: string;
    rel: string;
    fromField: string;
    targetId: string;
    toField: string;
    baseKeys: number;
    matched: number;
    rate: number;
    flag: "RED" | "WARN" | "OK";
  }> = [];

  for (const r of rels) {
    const bs = storById.get(r.baseId);
    const ts = storById.get(r.targetId);
    if (!bs?.tableName || !ts?.tableName) continue;
    const fromE = colExpr(bs, r.fromField, "b");
    const toE = colExpr(ts, r.toField, "t");
    const sql = `WITH bk AS (
        SELECT DISTINCT ${fromE} AS k FROM "${bs.tableName}" b
        WHERE b.deleted_at IS NULL AND ${fromE} IS NOT NULL AND ${fromE} <> ''
      ), tk AS (
        SELECT DISTINCT ${toE} AS k FROM "${ts.tableName}" t WHERE t.deleted_at IS NULL
      )
      SELECT (SELECT count(*) FROM bk) AS base_keys,
             (SELECT count(*) FROM bk WHERE k IN (SELECT k FROM tk)) AS matched`;
    try {
      const [row] = await query<{ base_keys: string; matched: string }>(sql);
      const baseKeys = Number(row?.base_keys ?? 0);
      const matched = Number(row?.matched ?? 0);
      const rate = baseKeys ? matched / baseKeys : 1;
      const flag = baseKeys === 0 ? "OK" : rate < 0.1 ? "RED" : rate < 0.6 ? "WARN" : "OK";
      report.push({
        ds: r.ds,
        rel: `${nm(r.baseId)}.${r.fromField} → ${nm(r.targetId)}.${r.toField}`,
        fromField: r.fromField,
        targetId: r.targetId,
        toField: r.toField,
        baseKeys,
        matched,
        rate: Math.round(rate * 1000) / 10,
        flag,
      });
    } catch {
      report.push({
        ds: r.ds,
        rel: `${nm(r.baseId)}.${r.fromField} → ${nm(r.targetId)}.${r.toField}`,
        fromField: r.fromField,
        targetId: r.targetId,
        toField: r.toField,
        baseKeys: -1,
        matched: -1,
        rate: -1,
        flag: "RED",
      });
    }
  }

  report.sort((a, b) => a.rate - b.rate);
  writeFileSync(pjoin(ERP_ROOT, "migration-plan/ui/join-key-report.json"), JSON.stringify({ report }, null, 1), "utf8");
  const red = report.filter((r) => r.flag === "RED");
  const warn = report.filter((r) => r.flag === "WARN");
  console.log(`${report.length} relation | RED(<10%): ${red.length} | WARN(10-60%): ${warn.length}\n`);
  console.log("=== RED — join key nghi SAI ===");
  for (const r of red) console.log(`  [${r.rate}%] ${r.ds}: ${r.rel} (${r.matched}/${r.baseKeys})`);
  console.log("\n=== WARN ===");
  for (const r of warn) console.log(`  [${r.rate}%] ${r.ds}: ${r.rel} (${r.matched}/${r.baseKeys})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
