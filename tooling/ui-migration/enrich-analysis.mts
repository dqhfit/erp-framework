/* ==========================================================
   enrich-analysis.mts — Phân tích page grid MỎNG: cột DQHF thiếu khỏi
   projection DataSource có "lấp được" không.

   Page mỏng = setFields (grid ∩ projection) < 6. Với mỗi page (title-match
   form DQHF):
     missing = grid form - projection keys.
   Phân loại từng cột missing:
     - "base": là field entity BASE nhưng chưa project → thêm field (base).
     - "joined:<entity>": là field 1 entity ĐÃ join (relation target) nhưng
       chưa project → thêm field (sourceRelationId = relation đó).
     - "no-source": không thuộc base lẫn entity đã join → cần JOIN MỚI hoặc
       cột dẫn xuất (bỏ qua, ghi nhận).

   Output: migration-plan/ui/enrich-plan.json + tóm tắt.
   Chạy (cwd packages/server):
     MIGRATION_MCP_KEY=... npx tsx ../../tooling/ui-migration/enrich-analysis.mts
   ========================================================== */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join as pjoin } from "node:path";

const require = createRequire(new URL("../../packages/server/package.json", import.meta.url));
const YAML = require("yaml") as typeof import("yaml");

const ERP_ROOT = "D:/code/cowok/Apps/erp-framework";
const UI_DIR = pjoin(ERP_ROOT, "migration-plan/ui");
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
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpc, method: "tools/call", params: { name: "migration_query_readonly", arguments: { sql } } }),
  });
  const j = (await res.json()) as { result?: { content?: Array<{ text?: string }> }; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return (JSON.parse(j.result?.content?.[0]?.text ?? "{}") as { rows?: T[] }).rows ?? [];
}

interface GridCol { field: string; header: string }
interface FormRec { form: string; title: string; grid?: { columns?: GridCol[] } }

const norm = (s: string) => s.trim().toLowerCase();

async function main() {
  // forms by title/name.
  const formBy = new Map<string, FormRec>();
  for (const file of readdirSync(UI_DIR).filter((f) => f.endsWith(".forms.yaml"))) {
    const doc = YAML.parse(readFileSync(pjoin(UI_DIR, file), "utf8")) as { forms?: FormRec[] };
    for (const f of doc.forms ?? []) {
      if (!(f.grid?.columns?.length ?? 0)) continue;
      if (f.title) formBy.set(norm(f.title), f);
      formBy.set(norm(f.form), f);
    }
  }

  // proposal (per-page) — lấy page mỏng title-match.
  const { proposal } = JSON.parse(readFileSync(pjoin(UI_DIR, "wiring-proposal.json"), "utf8")) as {
    proposal: Array<{ page: string; title: string; dataSource: string; setFields: string[]; matchType: string }>;
  };
  const thin = proposal.filter((p) => p.matchType === "title" && p.setFields.length < 6);

  // DS có liên quan → base entity + relations (id + target) + projection keys.
  const dsNames = [...new Set(thin.map((p) => p.dataSource))];
  const dsInfo = new Map<string, { baseId: string; rels: Array<{ id: string; targetId: string }>; keys: Set<string> }>();
  for (const name of dsNames) {
    // jsonb_agg trả jsonb → query_readonly đã parse sẵn (KHÔNG JSON.parse lại).
    const [row] = await query<{ base: string; rels: Array<{ id: string; targetId: string }> | null; keys: string }>(
      `SELECT config->>'baseEntityId' AS base,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r->>'id', 'targetId', r->>'targetEntityId')) FROM jsonb_array_elements(config->'relations') r), '[]'::jsonb) AS rels,
        COALESCE((SELECT string_agg(f->>'key', ',') FROM jsonb_array_elements(config->'fields') f), '') AS keys
       FROM datasources WHERE name='${name.replace(/'/g, "''")}'`,
    );
    if (!row) continue;
    dsInfo.set(name, {
      baseId: row.base,
      rels: Array.isArray(row.rels) ? row.rels : [],
      keys: new Set((row.keys ?? "").split(",").filter(Boolean)),
    });
  }

  // field names per entity (base + tất cả target).
  const entIds = [...new Set([...dsInfo.values()].flatMap((d) => [d.baseId, ...d.rels.map((r) => r.targetId)]))];
  const fieldRows = await query<{ id: string; name: string; fcsv: string }>(
    `SELECT id, name, COALESCE((SELECT string_agg(lower(f->>'name'), ',') FROM jsonb_array_elements(fields) f), '') AS fcsv
     FROM entities WHERE id IN (${entIds.map((i) => `'${i}'::uuid`).join(",")})`,
  );
  const entFields = new Map<string, { name: string; fields: Set<string> }>();
  for (const r of fieldRows) entFields.set(r.id, { name: r.name, fields: new Set((r.fcsv ?? "").split(",").filter(Boolean)) });

  const plan: Array<{
    page: string;
    dataSource: string;
    form: string;
    missingBase: string[];
    missingJoined: Array<{ field: string; relId: string; entity: string }>;
    missingNoSource: string[];
  }> = [];

  for (const p of thin) {
    const form = formBy.get(norm(p.title));
    const ds = dsInfo.get(p.dataSource);
    if (!form || !ds) continue;
    const grid = [...new Set((form.grid?.columns ?? []).map((c) => c.field))];
    const missing = grid.filter((g) => !ds.keys.has(g));
    const baseF = entFields.get(ds.baseId);
    const missingBase: string[] = [];
    const missingJoined: Array<{ field: string; relId: string; entity: string }> = [];
    const missingNoSource: string[] = [];
    for (const m of missing) {
      if (baseF?.fields.has(m)) {
        missingBase.push(m);
        continue;
      }
      let found: { relId: string; entity: string } | null = null;
      for (const r of ds.rels) {
        const ef = entFields.get(r.targetId);
        if (ef?.fields.has(m)) {
          found = { relId: r.id, entity: ef.name };
          break;
        }
      }
      if (found) missingJoined.push({ field: m, ...found });
      else missingNoSource.push(m);
    }
    plan.push({ page: p.page, dataSource: p.dataSource, form: form.form, missingBase, missingJoined, missingNoSource });
  }

  writeFileSync(pjoin(UI_DIR, "enrich-plan.json"), JSON.stringify({ plan }, null, 1), "utf8");
  const totBase = plan.reduce((s, p) => s + p.missingBase.length, 0);
  const totJoined = plan.reduce((s, p) => s + p.missingJoined.length, 0);
  const totNo = plan.reduce((s, p) => s + p.missingNoSource.length, 0);
  console.log(`${plan.length} page mỏng | cột thiếu: base=${totBase} joined=${totJoined} no-source=${totNo}\n`);
  for (const p of plan) {
    const j = p.missingJoined.map((x) => `${x.field}(${x.entity})`).join(", ");
    console.log(`${p.page} → ${p.dataSource} (${p.form}):`);
    if (p.missingBase.length) console.log(`    +base: ${p.missingBase.join(", ")}`);
    if (j) console.log(`    +joined: ${j}`);
    if (p.missingNoSource.length) console.log(`    no-source: ${p.missingNoSource.join(", ")}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
