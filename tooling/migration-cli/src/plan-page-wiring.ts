/* ==========================================================
   plan-page-wiring.ts — Lập kế hoạch wiring DataSource vào page draft.

   Với mỗi DataSource CÓ relation (join), tìm widget page đang bind
   config.entity = baseEntityId của DS. Phân loại theo GIÁ TRỊ wiring:
     - "fix-broken": fields[] của widget tham chiếu cột KHÔNG có trên
       entity base nhưng CÓ trong projection DS → cột đang rỗng, wiring
       làm hiện → giá trị CAO.
     - "plumbing": fields[] chỉ toàn cột base → wiring chỉ thêm khả năng
       (designer chọn cột join sau), không đổi hiển thị → giá trị THẤP.

   Output: migration-plan/ui/page-wiring-plan.json + tóm tắt stdout.
   Chạy: MIGRATION_MCP_KEY=... node --env-file=packages/server/.env \
     --import tsx tooling/migration-cli/src/plan-page-wiring.ts
   ========================================================== */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const MCP_URL = process.env.MIGRATION_MCP_URL ?? "https://erp.vfmgroup.vn/mcp/migration";
const KEY = process.env.MIGRATION_MCP_KEY ?? "";
if (!KEY) {
  console.error("Thiếu MIGRATION_MCP_KEY");
  process.exit(1);
}

let id = 0;
async function mcp<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "X-API-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++id,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const j = (await res.json()) as {
    error?: { message: string };
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
  };
  if (j.error || j.result?.isError) {
    throw new Error(j.error?.message ?? j.result?.content?.[0]?.text ?? "mcp error");
  }
  return JSON.parse(j.result?.content?.[0]?.text ?? "null") as T;
}

async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const r = await mcp<{ rows: T[] }>("migration_query_readonly", { sql });
  return r.rows ?? [];
}

async function main() {
  // 1. DataSource có relation: name, id, base, projection keys.
  const dsRows = await query<{ id: string; name: string; base: string; keys: string }>(
    `SELECT id, name, config->>'baseEntityId' AS base,
       (SELECT string_agg(f->>'key', ',') FROM jsonb_array_elements(config->'fields') f) AS keys
     FROM datasources WHERE COALESCE(jsonb_array_length(config->'relations'),0) > 0`,
  );
  const dsByBase = new Map<string, { id: string; name: string; keys: Set<string> }>();
  for (const d of dsRows) {
    // 1 base có thể nhiều DS — ưu tiên DS nhiều field nhất (join giàu hơn).
    const keys = new Set((d.keys ?? "").split(",").filter(Boolean));
    const prev = dsByBase.get(d.base);
    if (!prev || keys.size > prev.keys.size) dsByBase.set(d.base, { id: d.id, name: d.name, keys });
  }

  // 2. Field name của các entity base (để biết cột nào "gãy" trên entity thô).
  const baseFields = new Map<string, Set<string>>();
  for (const base of dsByBase.keys()) {
    const rows = await query<{ fname: string }>(
      `SELECT lower(f->>'name') AS fname FROM entities, jsonb_array_elements(fields) f
       WHERE id = '${base}'::uuid`,
    );
    baseFields.set(base, new Set(rows.map((r) => r.fname)));
  }

  // 3. Widget page bind base-entity của 1 DS (chưa wire).
  const widgets = await query<{
    page: string;
    title: string;
    entity: string;
    fieldsCsv: string;
    dsid: string | null;
  }>(
    `SELECT p.name AS page, elem->'config'->>'title' AS title,
       elem->'config'->>'entity' AS entity,
       (SELECT string_agg(x.v, ',') FROM jsonb_array_elements_text(elem->'config'->'fields') x(v)) AS "fieldsCsv",
       elem->'config'->>'dataSourceId' AS dsid
     FROM pages p, jsonb_array_elements(p.content) elem
     WHERE elem->'config'->>'entity' IS NOT NULL`,
  );

  const plan: Array<{
    page: string;
    title: string;
    entity: string;
    dsName: string;
    dsId: string;
    brokenFields: string[];
    value: "fix-broken" | "plumbing";
    alreadyWired: boolean;
  }> = [];

  for (const w of widgets) {
    const ds = dsByBase.get(w.entity);
    if (!ds) continue; // entity không có DS join
    const wf = (w.fieldsCsv ?? "").split(",").filter(Boolean);
    const bf = baseFields.get(w.entity) ?? new Set<string>();
    // Cột widget LIỆT KÊ mà KHÔNG có trên entity base nhưng CÓ trong DS projection.
    const broken = wf.filter((f) => !bf.has(f.toLowerCase()) && ds.keys.has(f));
    plan.push({
      page: w.page,
      title: w.title ?? "",
      entity: w.entity,
      dsName: ds.name,
      dsId: ds.id,
      brokenFields: broken,
      value: broken.length > 0 ? "fix-broken" : "plumbing",
      alreadyWired: w.dsid != null,
    });
  }

  const fixBroken = plan.filter((p) => p.value === "fix-broken" && !p.alreadyWired);
  const plumbing = plan.filter((p) => p.value === "plumbing" && !p.alreadyWired);
  writeFileSync(
    resolve(process.cwd(), "migration-plan/ui/page-wiring-plan.json"),
    JSON.stringify({ fixBroken, plumbing, total: plan.length }, null, 1),
    "utf8",
  );

  console.log(
    `Tổng widget bind DS-base: ${plan.length} | fix-broken: ${fixBroken.length} | plumbing: ${plumbing.length}`,
  );
  console.log(`\n=== FIX-BROKEN (wiring làm hiện cột đang rỗng) ===`);
  for (const p of fixBroken.slice(0, 40)) {
    console.log(`  ${p.page} → ${p.dsName}: [${p.brokenFields.join(", ")}]`);
  }
  if (fixBroken.length > 40) console.log(`  … +${fixBroken.length - 40} nữa`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
