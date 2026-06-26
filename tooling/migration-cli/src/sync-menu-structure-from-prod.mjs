/* sync-menu-structure-from-prod.mjs — Bổ sung phần CẤU TRÚC menu mà
   sync-menu-links-from-prod.mjs KHÔNG đụng tới: (1) node tuỳ chỉnh `CUST-*`
   user thêm qua trình sửa menu (không có trong SYS_MENU_NEW, nên import 2 bên
   không sinh ra) → upsert từ prod; (2) cờ `active` lệch giữa prod↔dev → mirror
   theo prod (node bị ẩn/hiện khác nhau làm portal khuyết mục).

   page_id của node CUST chỉ set khi trang tồn tại local (chạy SAU sync pages);
   thiếu trang → để null (node nhóm vẫn hiện nếu có hậu duệ). Không xoá node
   dev-only. Đọc prod chỉ-đọc qua MCP, ghi dev qua postgres-js.
   Chạy: node tooling/migration-cli/src/sync-menu-structure-from-prod.mjs
*/
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const COMPANY = "00000000-0000-0000-0000-000000000001";
const URL = "https://erp.vfmgroup.vn/mcp/migration";

function localDbUrl() {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const env = readFileSync(join(root, "packages", "db", ".env"), "utf8");
    const m = env.match(/^DATABASE_URL=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch {}
  return "postgres://erp:erp@localhost:5433/erp_sample";
}

function findKey() {
  if (process.env.MCP_API_KEY) return process.env.MCP_API_KEY;
  const cfg = JSON.parse(readFileSync(join(homedir(), ".claude.json"), "utf8"));
  const proj = cfg.projects?.["D:/code/cowok/Apps/erp-framework"];
  const servers = { ...(cfg.mcpServers ?? {}), ...(proj?.mcpServers ?? {}) };
  for (const name of ["erp-migration", "erp-feedback"]) {
    const k = servers[name]?.headers?.["X-API-Key"];
    if (k) return k;
  }
  for (const s of Object.values(servers)) {
    const k = s?.headers?.["X-API-Key"];
    if (k) return k;
  }
  throw new Error("Không tìm thấy X-API-Key MCP trong ~/.claude.json");
}
const KEY = findKey();

let rpc = 0;
async function mcp(name, args) {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "X-API-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpc, method: "tools/call", params: { name, arguments: args } }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  const t = j.result?.content?.[0]?.text ?? "";
  if (j.result?.isError) throw new Error(t);
  return JSON.parse(t);
}

const sqldb = postgres(localDbUrl(), { max: 1 });
try {
  // 1) Node tuỳ chỉnh CUST-* từ prod (full row, trừ id/source_id).
  console.log("1) Kéo node CUST-* từ prod…");
  const rCust = await mcp("migration_query_readonly", {
    sql: `SELECT coalesce(json_agg(json_build_object(
            'source_code',source_code,'name',name,'level',level,'parent_code',parent_code,
            'sort',sort,'win_id',win_id,'namespace',namespace,'system',system,
            'is_show_dialog',is_show_dialog,'active',active,'port_status',port_status,
            'module',module,'page_id',page_id,'overrides',overrides,'custom',custom)),'[]') AS data
          FROM legacy_menu_map WHERE company_id='${COMPANY}' AND source_code LIKE 'CUST-%'`,
  });
  const cust = rCust.rows?.[0]?.data ?? [];
  console.log(`   prod: ${cust.length} node CUST-*.`);

  // page_id phải tồn tại local (đã sync pages). Thiếu → null.
  const wantPages = [...new Set(cust.filter((x) => x.page_id).map((x) => x.page_id))];
  const have = wantPages.length
    ? new Set((await sqldb`SELECT id FROM pages WHERE id = ANY(${wantPages})`).map((r) => r.id))
    : new Set();

  let ins = 0;
  let upd = 0;
  await sqldb.begin(async (tx) => {
    for (const x of cust) {
      const pid = x.page_id && have.has(x.page_id) ? x.page_id : null;
      const ovr = x.overrides == null ? null : JSON.stringify(x.overrides);
      const exists = await tx`SELECT 1 FROM legacy_menu_map WHERE company_id=${COMPANY} AND source_code=${x.source_code} LIMIT 1`;
      if (exists.length) {
        await tx`
          UPDATE legacy_menu_map SET
            name=${x.name}, level=${x.level}, parent_code=${x.parent_code}, sort=${x.sort},
            win_id=${x.win_id}, namespace=${x.namespace}, system=${x.system},
            is_show_dialog=${x.is_show_dialog ?? false}, active=${x.active ?? true},
            port_status=${x.port_status ?? "chua"}, module=${x.module}, page_id=${pid},
            overrides=${ovr}::jsonb, custom=${x.custom ?? true}, updated_at=now()
          WHERE company_id=${COMPANY} AND source_code=${x.source_code}`;
        upd++;
      } else {
        await tx`
          INSERT INTO legacy_menu_map
            (id, company_id, source_id, source_code, name, level, parent_code, sort, win_id, namespace,
             system, is_show_dialog, active, port_status, module, page_id, overrides, custom, imported_at, updated_at)
          VALUES (gen_random_uuid(), ${COMPANY}, 0, ${x.source_code}, ${x.name}, ${x.level},
             ${x.parent_code}, ${x.sort}, ${x.win_id}, ${x.namespace}, ${x.system},
             ${x.is_show_dialog ?? false}, ${x.active ?? true}, ${x.port_status ?? "chua"},
             ${x.module}, ${pid}, ${ovr}::jsonb, ${x.custom ?? true}, now(), now())`;
        ins++;
      }
    }
  });
  console.log(`   → CUST: thêm ${ins}, cập nhật ${upd}.`);

  // 2) Mirror cờ active cho node thường (lệch prod↔dev → ẩn/hiện sai).
  console.log("2) Đồng bộ cờ active theo prod…");
  const rAct = await mcp("migration_query_readonly", {
    sql: `SELECT coalesce(json_agg(json_build_object('c',source_code,'a',active)),'[]') AS data
          FROM legacy_menu_map WHERE company_id='${COMPANY}'`,
  });
  const acts = rAct.rows?.[0]?.data ?? [];
  let actFix = 0;
  await sqldb.begin(async (tx) => {
    for (const x of acts) {
      const res = await tx`
        UPDATE legacy_menu_map SET active=${x.a}, updated_at=now()
        WHERE company_id=${COMPANY} AND source_code=${x.c} AND active IS DISTINCT FROM ${x.a}`;
      if (res.count > 0) actFix++;
    }
  });
  console.log(`   → active đổi: ${actFix} node.`);

  console.log("\n✓ XONG. Chạy lại sync-menu-links-from-prod nếu cần settle page_id.");
} finally {
  await sqldb.end();
}
