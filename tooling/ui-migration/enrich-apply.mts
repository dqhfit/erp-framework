/* ==========================================================
   enrich-apply.mts — Thêm cột MISSING-JOINED vào projection DataSource
   (đọc enrich-plan.json). Các cột này thuộc entity ĐÃ join (master
   many-to-one: tr_sanpham/tr_material/tr_khachhang…) nhưng codegen chưa
   project → thêm field {key, sourceRelationId, sourceField, label, type}.
   An toàn: không thêm join mới (relation đã có), không đụng cột detail.

   dryRun mặc định. --apply để ghi (datasource_create_draft overwrite).
   Chạy (cwd packages/server):
     MIGRATION_MCP_KEY=... npx tsx ../../tooling/ui-migration/enrich-apply.mts [--apply]
   ========================================================== */
import { readFileSync } from "node:fs";
import { join as pjoin } from "node:path";

const ERP_ROOT = "D:/code/cowok/Apps/erp-framework";
const MCP_URL = process.env.MIGRATION_MCP_URL ?? "https://erp.vfmgroup.vn/mcp/migration";
const KEY = process.env.MIGRATION_MCP_KEY ?? "";
if (!KEY) {
  console.error("Thiếu MIGRATION_MCP_KEY");
  process.exit(1);
}
const APPLY = process.argv.includes("--apply");

let rpc = 0;
async function mcp<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "X-API-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpc, method: "tools/call", params: { name, arguments: args } }),
  });
  const j = (await res.json()) as {
    error?: { message: string };
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
  };
  if (j.error || j.result?.isError) throw new Error(j.error?.message ?? j.result?.content?.[0]?.text ?? "mcp error");
  return JSON.parse(j.result?.content?.[0]?.text ?? "null") as T;
}
async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  return (await mcp<{ rows: T[] }>("migration_query_readonly", { sql })).rows ?? [];
}

interface PlanItem {
  dataSource: string;
  missingJoined: Array<{ field: string; relId: string; entity: string }>;
}

async function main() {
  const { plan } = JSON.parse(readFileSync(pjoin(ERP_ROOT, "migration-plan/ui/enrich-plan.json"), "utf8")) as {
    plan: PlanItem[];
  };
  // Gom theo DS: field cần thêm (key field|relId duy nhất) + entity nguồn.
  const addByDs = new Map<string, Map<string, { field: string; relId: string; entity: string }>>();
  for (const p of plan) {
    for (const j of p.missingJoined) {
      const m = addByDs.get(p.dataSource) ?? new Map();
      m.set(`${j.field}|${j.relId}`, j);
      addByDs.set(p.dataSource, m);
    }
  }

  // Type/label field từ entity nguồn (target) — để projection field đúng kiểu.
  const entNames = [...new Set([...addByDs.values()].flatMap((m) => [...m.values()].map((x) => x.entity)))];
  const typeByEntField = new Map<string, { type: string; label: string }>();
  for (const en of entNames) {
    const rows = await query<{ fname: string; ftype: string; flabel: string }>(
      `SELECT lower(f->>'name') AS fname, f->>'type' AS ftype, COALESCE(f->>'label', f->>'name') AS flabel
       FROM entities, jsonb_array_elements(fields) f WHERE name='${en.replace(/'/g, "''")}'`,
    );
    for (const r of rows) typeByEntField.set(`${en}|${r.fname}`, { type: r.ftype, label: r.flabel });
  }

  let fixed = 0;
  for (const [dsName, adds] of addByDs) {
    const [meta] = await query<{ label: string; icon: string | null; config: string }>(
      `SELECT label, icon, config::text AS config FROM datasources WHERE name='${dsName.replace(/'/g, "''")}'`,
    );
    if (!meta?.config) {
      console.log(`${dsName}: BỎ QUA (config >150KB)`);
      continue;
    }
    const cfg = JSON.parse(meta.config) as { fields?: Array<{ key?: string }>; [k: string]: unknown };
    const fields = cfg.fields ?? [];
    const existing = new Set(fields.map((f) => String(f.key)));
    const added: string[] = [];
    for (const a of adds.values()) {
      if (existing.has(a.field)) continue; // đã có (key trùng) → bỏ
      const t = typeByEntField.get(`${a.entity}|${a.field}`) ?? { type: "text", label: a.field };
      fields.push({
        key: a.field,
        sourceRelationId: a.relId,
        sourceField: a.field,
        label: t.label,
        type: t.type,
      } as Record<string, unknown>);
      added.push(`${a.field}(${a.entity})`);
    }
    if (added.length === 0) {
      console.log(`${dsName}: không thêm gì (key trùng)`);
      continue;
    }
    fixed++;
    console.log(`${dsName}: +${added.length} field [${added.join(", ")}] | field ${existing.size}→${fields.length}`);
    if (APPLY) {
      const r = await mcp<{ status: string }>("datasource_create_draft", {
        name: dsName,
        label: meta.label,
        ...(meta.icon ? { icon: meta.icon } : {}),
        config: { ...cfg, fields },
        overwrite: true,
      });
      console.log(`    → ${r.status}`);
    }
  }
  console.log(`\n${APPLY ? "Đã enrich" : "Sẽ enrich"}: ${fixed} DataSource`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
