/* sync-menu-links-from-prod.mjs — Mirror gán trang của menu DQHF (cột
   legacy_menu_map.page_id) từ PROD về dev local theo source_code (khóa ổn định,
   cùng SYS_MENU_NEW 2 bên). Mirror CHÍNH XÁC: node prod có link → set; node prod
   không link nhưng local có → xoá. CHỈ đụng page_id (không động structure/status).
   Chạy SAU khi đã sync pages (page_id phải trỏ tới trang tồn tại local).
   Node thuần + postgres-js. Đọc prod chỉ-đọc qua MCP. node tooling/migration-cli/src/sync-menu-links-from-prod.mjs
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
  console.log("1) Kéo (source_code, page_id) menu từ prod…");
  // 707 dòng nhỏ → 1 query (json_agg) đủ dưới cap.
  const r = await mcp("migration_query_readonly", {
    sql: `SELECT coalesce(json_agg(json_build_object('c', source_code, 'p', page_id)), '[]'::json) AS data
          FROM legacy_menu_map WHERE company_id = '${COMPANY}'`,
  });
  const prod = r.rows?.[0]?.data ?? [];
  const prodLinked = prod.filter((x) => x.p).length;
  console.log(`   prod: ${prod.length} node, ${prodLinked} có gán trang.`);

  // page_id prod phải tồn tại local (đã sync pages). Kiểm tra để không vỡ FK.
  const wantIds = [...new Set(prod.filter((x) => x.p).map((x) => x.p))];
  const existing = await sqldb`SELECT id FROM pages WHERE id = ANY(${wantIds})`;
  const haveIds = new Set(existing.map((e) => e.id));
  const missing = wantIds.filter((id) => !haveIds.has(id));
  if (missing.length) {
    console.log(`   ⚠ ${missing.length} page_id prod CHƯA có ở local → sẽ bỏ qua các node đó (chạy sync pages trước).`);
  }

  const beforeRow = await sqldb`SELECT count(page_id)::int AS n FROM legacy_menu_map WHERE company_id = ${COMPANY}`;

  console.log("2) Mirror page_id vào local (set link prod có, xoá link local thừa)…");
  let setCnt = 0;
  let clrCnt = 0;
  await sqldb.begin(async (tx) => {
    for (const x of prod) {
      const target = x.p && haveIds.has(x.p) ? x.p : null;
      const res = await tx`
        UPDATE legacy_menu_map
        SET page_id = ${target},
            port_status = CASE WHEN ${target}::uuid IS NOT NULL THEN 'xong' ELSE port_status END,
            updated_at = now()
        WHERE company_id = ${COMPANY} AND source_code = ${x.c}
          AND page_id IS DISTINCT FROM ${target}`;
      if (res.count > 0) {
        if (target) setCnt++;
        else clrCnt++;
      }
    }
  });

  const afterRow = await sqldb`SELECT count(page_id)::int AS n FROM legacy_menu_map WHERE company_id = ${COMPANY}`;
  console.log(`\n✓ XONG. Link local: ${beforeRow[0].n} → ${afterRow[0].n} (prod ${prodLinked}).`);
  console.log(`   đã set/đổi: ${setCnt} | đã gỡ: ${clrCnt}.`);
} finally {
  await sqldb.end();
}
