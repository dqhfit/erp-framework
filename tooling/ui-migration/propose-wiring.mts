/* ==========================================================
   propose-wiring.mts — Đề xuất setFields PER-PAGE (bám grid DQHF) cho wiring.

   Đơn vị = từng widget page (KHÔNG per-DataSource): mỗi page tương ứng 1
   form DQHF riêng → phải dùng grid form ĐÓ, không áp chung 1 grid cho mọi
   page cùng entity (vd 31 page bind tr_sanpham là 31 form khác nhau).

   Với mỗi widget chưa wire bind base-entity của 1 DataSource:
   - Khớp widget.config.title ↔ form DQHF (theo form.title hoặc form name).
   - setFields = cột grid form đó GIỮ THỨ TỰ DQHF ∩ projection DataSource.
   - matchType: "title" (khớp tiêu đề form) | "fallback" (không khớp → form
     phủ projection tốt nhất cho entity).

   Output: migration-plan/ui/wiring-proposal.json + stdout.
   Chạy (cwd packages/server):
     MIGRATION_MCP_KEY=... npx tsx ../../tooling/ui-migration/propose-wiring.mts
   ========================================================== */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(new URL("../../packages/server/package.json", import.meta.url));
const YAML = require("yaml") as typeof import("yaml");

const ERP_ROOT = "D:/code/cowok/Apps/erp-framework";
const UI_DIR = join(ERP_ROOT, "migration-plan/ui");
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
  const j = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
  const o = JSON.parse(j.result?.content?.[0]?.text ?? "{}") as { rows?: T[] };
  return o.rows ?? [];
}

interface GridCol {
  field: string;
  header: string;
}
interface FormRec {
  form: string;
  title: string;
  entities?: string[];
  grid?: { columns?: GridCol[] };
}

const norm = (s: string) => s.trim().toLowerCase();

async function main() {
  // 1. Index form DQHF: theo title + theo form name; và theo entity (fallback).
  const formByTitle = new Map<string, FormRec>();
  const formsByEntity = new Map<string, FormRec[]>();
  for (const file of readdirSync(UI_DIR).filter((f) => f.endsWith(".forms.yaml"))) {
    const doc = YAML.parse(readFileSync(join(UI_DIR, file), "utf8")) as { forms?: FormRec[] };
    for (const f of doc.forms ?? []) {
      if (!(f.grid?.columns?.length ?? 0)) continue;
      if (f.title) formByTitle.set(norm(f.title), f);
      formByTitle.set(norm(f.form), f);
      for (const e of f.entities ?? []) {
        const l = formsByEntity.get(e) ?? [];
        l.push(f);
        formsByEntity.set(e, l);
      }
    }
  }

  // 2. DataSource có relation: base → {name, projKeys, baseName}.
  const dsRows = await query<{ name: string; base: string; keys: string; baseName: string }>(
    `SELECT d.name, d.config->>'baseEntityId' AS base,
       (SELECT string_agg(f->>'key', ',') FROM jsonb_array_elements(d.config->'fields') f) AS keys,
       e.name AS "baseName"
     FROM datasources d JOIN entities e ON e.id = (d.config->>'baseEntityId')::uuid
     WHERE COALESCE(jsonb_array_length(d.config->'relations'),0) > 0`,
  );
  const dsByBase = new Map<string, { name: string; keys: Set<string>; baseName: string }>();
  for (const d of dsRows) {
    const keys = new Set((d.keys ?? "").split(",").filter(Boolean));
    const prev = dsByBase.get(d.base);
    if (!prev || keys.size > prev.keys.size)
      dsByBase.set(d.base, { name: d.name, keys, baseName: d.baseName });
  }

  // 3. Widget page draft bind base-entity (CẢ đã wire — để re-apply columnLabels
  //     / setFields mới; tool page_wire_datasource idempotent).
  const widgets = await query<{ page: string; title: string | null; entity: string }>(
    `SELECT p.name AS page, elem->'config'->>'title' AS title, elem->'config'->>'entity' AS entity
     FROM pages p, jsonb_array_elements(p.content) elem
     WHERE elem->'config'->>'entity' IS NOT NULL AND p.published = false`,
  );

  const proposal: Array<{
    page: string;
    title: string;
    dataSource: string;
    fromForm: string;
    matchType: "title" | "fallback";
    setFields: string[];
    columnLabels: Record<string, string>;
  }> = [];

  for (const w of widgets) {
    const ds = dsByBase.get(w.entity);
    if (!ds) continue;
    let form: FormRec | undefined;
    let matchType: "title" | "fallback" = "title";
    if (w.title) form = formByTitle.get(norm(w.title));
    if (!form) {
      // fallback: form phủ projection tốt nhất cho entity base.
      matchType = "fallback";
      let bestHit = 0;
      for (const c of formsByEntity.get(ds.baseName) ?? []) {
        const hit = (c.grid?.columns ?? []).filter((col) => ds.keys.has(col.field)).length;
        if (hit > bestHit) {
          bestHit = hit;
          form = c;
        }
      }
    }
    if (!form) continue;
    const seen = new Set<string>();
    const setFields: string[] = [];
    // Header DQHF per-cột (lọc tên auto-gen rác: gridColumn*, Column*, rỗng).
    const columnLabels: Record<string, string> = {};
    for (const col of form.grid?.columns ?? []) {
      if (ds.keys.has(col.field) && !seen.has(col.field)) {
        seen.add(col.field);
        setFields.push(col.field);
        const h = (col.header ?? "").trim();
        if (h && !/^(grid)?column\d*$/i.test(h)) columnLabels[col.field] = h;
      }
    }
    if (setFields.length < 2) continue; // quá ít cột join → bỏ
    proposal.push({
      page: w.page,
      title: w.title ?? "",
      dataSource: ds.name,
      fromForm: form.form,
      matchType,
      setFields,
      columnLabels,
    });
  }

  proposal.sort((a, b) => (a.matchType === b.matchType ? 0 : a.matchType === "title" ? -1 : 1));
  writeFileSync(
    join(UI_DIR, "wiring-proposal.json"),
    JSON.stringify({ count: proposal.length, proposal }, null, 1),
    "utf8",
  );
  const byTitle = proposal.filter((p) => p.matchType === "title");
  console.log(`Đề xuất ${proposal.length} page (khớp title: ${byTitle.length}, fallback: ${proposal.length - byTitle.length})\n`);
  for (const p of proposal) {
    console.log(`[${p.matchType}] ${p.page} → ${p.dataSource} (form ${p.fromForm}, ${p.setFields.length} cột)`);
    console.log(`    ${p.setFields.join(", ")}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
