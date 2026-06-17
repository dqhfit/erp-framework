/* sync-pages-from-prod.mjs — Kéo bảng `pages` (định nghĩa trang low-code) từ
   PROD (https://erp.vfmgroup.vn) về DB dev local (erp_sample), upsert theo id.
   - Đọc prod CHỈ-ĐỌC qua MCP migration_query_readonly (JSON-RPC, X-API-Key đọc
     từ ~/.claude.json — KHÔNG in key).
   - Cùng company_id 2 bên → khớp trực tiếp theo id (UUID toàn cục).
   - PROD WINS: trang trùng id → ghi đè; trang chỉ có ở prod → thêm mới;
     trang chỉ có ở local → GIỮ NGUYÊN (không xoá), báo lại để tự quyết.
   - Va chạm unique (company_id, name) khác id → xoá bản local cũ rồi nạp bản prod.
   Node thuần + postgres-js. Chạy: node tooling/migration-cli/src/sync-pages-from-prod.mjs
*/
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const COMPANY = "00000000-0000-0000-0000-000000000001";
const URL = "https://erp.vfmgroup.vn/mcp/migration";

// DATABASE_URL local: ưu tiên packages/db/.env, fallback mặc định docker.
function localDbUrl() {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const env = readFileSync(join(root, "packages", "db", ".env"), "utf8");
    const m = env.match(/^DATABASE_URL=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch {}
  return "postgres://erp:erp@localhost:5433/erp_sample";
}
const LOCAL = localDbUrl();

// ── API key MCP từ ~/.claude.json (không in ra) ──
function findKey() {
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

// ── Kéo toàn bộ pages prod (batch để tránh cap ~200KB/response) ──
async function fetchProdPages() {
  const out = [];
  const LIMIT = 50;
  for (let off = 0; ; off += LIMIT) {
    const sql = `SELECT coalesce(json_agg(p), '[]'::json) AS data FROM (SELECT id, company_id, name, label, icon, content, published, publish_mode, created_at, updated_at FROM pages WHERE company_id = '${COMPANY}' ORDER BY id LIMIT ${LIMIT} OFFSET ${off}) p`;
    const r = await mcp("migration_query_readonly", { sql });
    const data = r.rows?.[0]?.data ?? [];
    out.push(...data);
    process.stdout.write(`  · kéo ${out.length} trang…\r`);
    if (data.length < LIMIT) break;
  }
  console.log(`\n  → prod có ${out.length} trang.`);
  return out;
}

const sqldb = postgres(LOCAL, { max: 1 });
try {
  console.log("1) Kéo pages từ prod…");
  const prod = await fetchProdPages();
  const prodIds = new Set(prod.map((p) => p.id));
  const prodNames = prod.map((p) => p.name);

  console.log("2) Trạng thái local trước khi sync…");
  const before = await sqldb`SELECT id, name FROM pages WHERE company_id = ${COMPANY}`;
  const beforeIds = new Set(before.map((r) => r.id));
  const newOnes = prod.filter((p) => !beforeIds.has(p.id)).length;
  const updated = prod.length - newOnes;
  const localOnly = before.filter((r) => !prodIds.has(r.id));

  console.log(`   local: ${before.length} trang | sẽ THÊM ${newOnes}, GHI ĐÈ ${updated}.`);

  console.log("3) Upsert (prod wins)…");
  await sqldb.begin(async (tx) => {
    // Xoá bản local trùng TÊN nhưng khác id (tránh vỡ unique company+name).
    const clash = await tx`
      SELECT id, name FROM pages
      WHERE company_id = ${COMPANY} AND name = ANY(${prodNames}) AND id <> ALL(${[...prodIds]})`;
    if (clash.length) {
      console.log(`   ⚠ ${clash.length} trang local trùng tên-khác-id → thay bằng bản prod:`);
      for (const c of clash) console.log(`     - ${c.name} (local id ${c.id.slice(0, 8)})`);
      await tx`DELETE FROM pages WHERE company_id = ${COMPANY} AND name = ANY(${prodNames}) AND id <> ALL(${[...prodIds]})`;
    }
    for (const p of prod) {
      await tx`
        INSERT INTO pages (id, company_id, name, label, icon, content, published, publish_mode, created_at, updated_at)
        VALUES (${p.id}, ${p.company_id}, ${p.name}, ${p.label}, ${p.icon},
                ${tx.json(p.content)}, ${p.published}, ${p.publish_mode ?? "private"}, ${p.created_at}, ${p.updated_at})
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, label = EXCLUDED.label, icon = EXCLUDED.icon,
          content = EXCLUDED.content, published = EXCLUDED.published,
          publish_mode = EXCLUDED.publish_mode, updated_at = EXCLUDED.updated_at`;
    }
  });

  const after = await sqldb`SELECT count(*)::int AS n FROM pages WHERE company_id = ${COMPANY}`;
  console.log(`\n✓ XONG. Local giờ có ${after[0].n} trang (prod ${prod.length}).`);
  if (localOnly.length) {
    console.log(`\n${localOnly.length} trang CHỈ có ở local (đã GIỮ, không xoá):`);
    for (const r of localOnly) console.log(`   - ${r.name} (${r.id.slice(0, 8)})`);
  } else {
    console.log("Không có trang local-only.");
  }
} finally {
  await sqldb.end();
}
