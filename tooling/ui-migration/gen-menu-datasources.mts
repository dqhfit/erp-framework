/* ==========================================================
   gen-menu-datasources.mts — Tạo/căn DataSource cho entity chính của trang
   menu-driven CHƯA có DS-join. Suy join AN TOÀN: chỉ thêm relation tới
   entity liên quan (cùng form, forms.yaml) khi match-rate ≥ MIN_RATE
   (tránh join sai như codegen cũ). Entity master/lookup không có join tốt
   → DS single-entity (vẫn nhất quán wire qua DataSource).

   Reuse logic match-rate (diagnose-join-keys) + datasource_create_draft.
   Sau đó chạy fix-ds-joins (inner→left) + diagnose để xác nhận.

   dryRun mặc định. --apply để ghi.
   Chạy (cwd packages/server):
     MIGRATION_MCP_KEY=... npx tsx ../../tooling/ui-migration/gen-menu-datasources.mts [--apply]
   ========================================================== */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join as pjoin } from "node:path";

const require = createRequire(new URL("../../packages/server/package.json", import.meta.url));
const YAML = require("yaml") as typeof import("yaml");

const ERP_ROOT = "D:/code/cowok/Apps/erp-framework";
const UI_DIR = pjoin(ERP_ROOT, "migration-plan/ui");
const MCP_URL = process.env.MIGRATION_MCP_URL ?? "https://erp.vfmgroup.vn/mcp/migration";
const KEY = process.env.MIGRATION_MCP_KEY ?? "";
if (!KEY) { console.error("Thiếu MIGRATION_MCP_KEY"); process.exit(1); }
const APPLY = process.argv.includes("--apply");
const MIN_RATE = 0.6;
const CONTEXT = new Set(["sys_user", "sys_user_rule", "tr_bophan", "tr_nguoiduyet", "hr_congty", "tr_common", "tr_site"]);

let rpc = 0;
async function mcp<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(MCP_URL, { method: "POST", headers: { "X-API-Key": KEY, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpc, method: "tools/call", params: { name, arguments: args } }) });
  const j = (await res.json()) as { result?: { content?: Array<{ text?: string }>; isError?: boolean }; error?: { message: string } };
  if (j.error || j.result?.isError) throw new Error(j.error?.message ?? j.result?.content?.[0]?.text ?? "err");
  return JSON.parse(j.result?.content?.[0]?.text ?? "null") as T;
}
async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  return (await mcp<{ rows: T[] }>("migration_query_readonly", { sql })).rows ?? [];
}

function colExpr(cols: Record<string, { col: string }>, field: string, alias: string) {
  const m = cols[field];
  return m ? `${alias}."${m.col}"::text` : `(${alias}.ext->>'${field}')`;
}

async function main() {
  // 1. Entity chính menu-driven thiếu DS-join.
  const missing = await query<{ id: string; name: string }>(
    `WITH pg AS (SELECT DISTINCT content->0->'config'->>'entity' AS eid FROM pages WHERE name ~ '^dq_(p|g)[0-9]' AND content->0->'config'->>'entity' IS NOT NULL)
     SELECT e.id, e.name FROM pg JOIN entities e ON e.id = pg.eid::uuid
     WHERE NOT EXISTS (SELECT 1 FROM datasources d WHERE d.config->>'baseEntityId' = pg.eid)`,
  );

  // related: entity co-occur trong forms.yaml (local, không truncate).
  const relatedOf = new Map<string, Set<string>>();
  for (const file of readdirSync(UI_DIR).filter((f) => f.endsWith(".forms.yaml"))) {
    const doc = YAML.parse(readFileSync(pjoin(UI_DIR, file), "utf8")) as { forms?: Array<{ entities?: string[] }> };
    for (const f of doc.forms ?? []) {
      for (const e of f.entities ?? []) {
        const s = relatedOf.get(e) ?? new Set<string>();
        for (const o of f.entities ?? []) if (o !== e) s.add(o);
        relatedOf.set(e, s);
      }
    }
  }

  // 2. meta CHỈ cho entity cần (missing + related) — query_readonly cắt >150KB
  //    nên KHÔNG lấy cả 228 entity. Bounded set.
  const needed = new Set<string>();
  for (const m of missing) {
    needed.add(m.name.toLowerCase());
    for (const r of relatedOf.get(m.name) ?? []) needed.add(r.toLowerCase());
  }
  const meta = new Map<string, { id: string; table: string; cols: Record<string, { col: string }>; fields: Set<string> }>();
  const nameList = [...needed].map((n) => `'${n.replace(/'/g, "''")}'`).join(",");
  if (nameList) {
    const rows = await query<{ id: string; name: string; table: string; cols: string; fcsv: string }>(
      `SELECT id, name, meta->'storage'->>'tableName' AS table, COALESCE((meta->'storage'->'columns')::text,'{}') AS cols,
         COALESCE((SELECT string_agg(lower(f->>'name'),',') FROM jsonb_array_elements(fields) f),'') AS fcsv
       FROM entities WHERE lower(name) IN (${nameList})`,
    );
    for (const r of rows) meta.set(r.name.toLowerCase(), { id: r.id, table: r.table, cols: JSON.parse(r.cols), fields: new Set((r.fcsv ?? "").split(",").filter(Boolean)) });
  }

  // match-rate giữa base.F và target.F (cùng tên field).
  async function rate(baseName: string, relName: string, field: string): Promise<number> {
    const b = meta.get(baseName), r = meta.get(relName);
    if (!b?.table || !r?.table) return 0;
    const bE = colExpr(b.cols, field, "b"), rE = colExpr(r.cols, field, "t");
    try {
      const [row] = await query<{ bk: string; mt: string }>(
        `WITH bk AS (SELECT DISTINCT ${bE} AS k FROM "${b.table}" b WHERE b.deleted_at IS NULL AND ${bE} IS NOT NULL AND ${bE}<>''), tk AS (SELECT DISTINCT ${rE} AS k FROM "${r.table}" t WHERE t.deleted_at IS NULL) SELECT (SELECT count(*) FROM bk) AS bk, (SELECT count(*) FROM bk WHERE k IN (SELECT k FROM tk)) AS mt`,
      );
      const bk = Number(row?.bk ?? 0); return bk ? Number(row?.mt ?? 0) / bk : 0;
    } catch { return 0; }
  }

  let made = 0;
  for (const m of missing) {
    const base = meta.get(m.name);
    if (!base) continue;
    const relations: Record<string, unknown>[] = [];
    const projFields: Record<string, unknown>[] = [...base.fields].map((f) => ({ key: f, sourceRelationId: "base", sourceField: f, label: f, type: "text" }));
    let ri = 0;
    for (const relName of relatedOf.get(m.name) ?? []) {
      if (CONTEXT.has(relName)) continue;
      const rel = meta.get(relName);
      if (!rel?.table) continue;
      // candidate join key = field KEY THẬT chung 2 entity (loại generic
      // active/id/create_by — match cao giả vì entity nào cũng có).
      const KEY = /^(masp|mavt|makho|maddh|mancc|mabophan|matson|customer|customer_id|order_number|item_number|masp_khachhang|masp_nhamay|lenhcapphatid|dexuat_id|phieuyeucau_id|maht|mahtr)$|_id$|code$/i;
      let bestF: string | null = null, bestR = 0;
      for (const f of base.fields) {
        if (!rel.fields.has(f) || !KEY.test(f)) continue;
        const rr = await rate(m.name, relName, f);
        if (rr > bestR) { bestR = rr; bestF = f; }
      }
      if (bestF && bestR >= MIN_RATE) {
        const rid = `r${++ri}`;
        relations.push({ id: rid, alias: rid, fromRelationId: null, fromField: bestF, toField: bestF, targetEntityId: rel.id, joinKind: "left" });
        // project vài cột "tên/mô tả" của related (tránh trùng key base).
        for (const rf of rel.fields) {
          if (base.fields.has(rf)) continue;
          if (/^(ten|name|mota|description|quycach|mausac|dvt)/i.test(rf)) projFields.push({ key: `${rid}_${rf}`, sourceRelationId: rid, sourceField: rf, label: rf, type: "text" });
        }
      }
    }
    const dsName = `ds_${m.name.replace(/^tr_?/, "").replace(/[^a-z0-9_]/g, "_")}_menu`.slice(0, 60);
    made++;
    console.log(`${dsName}: base ${m.name}, ${relations.length} join [${relations.map((r) => (r as { fromField: string }).fromField).join(",")}], ${projFields.length} field`);
    if (APPLY) {
      const r = await mcp<{ status: string }>("datasource_create_draft", { name: dsName, label: m.name, config: { baseEntityId: m.id, relations, fields: projFields }, overwrite: true });
      console.log(`    → ${r.status}`);
    }
  }
  console.log(`\n${APPLY ? "Tạo" : "Preview"} ${made} DataSource (join ≥${MIN_RATE * 100}%)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
