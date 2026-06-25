/* sync-pages-from-prod.mjs — Kéo `pages` + datasources phụ thuộc từ PROD về local.
   - PROD WINS: trang trùng id → ghi đè; mới ở prod → thêm; chỉ local → GIỮ + báo.
   - DS kéo về lưu với PROD UUID (prod-as-hub) — entity UUID dịch prod→local theo tên.
   - Thêm --no-deps để bỏ qua sync datasource.
   Chạy: node tooling/migration-cli/src/sync-pages-from-prod.mjs
*/
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const COMPANY = "00000000-0000-0000-0000-000000000001";
const URL = "https://erp.vfmgroup.vn/mcp/migration";
const NO_DEPS = process.argv.includes("--no-deps");

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
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++rpc,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  const t = j.result?.content?.[0]?.text ?? "";
  if (j.result?.isError) throw new Error(t);
  return JSON.parse(t);
}

// ── Fetch pages from prod (keyset pagination) ────────────────────────────
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

// ── Extract DS IDs from page content ────────────────────────────────────
function extractDsIds(content) {
  const components = Array.isArray(content) ? content : (content?.components ?? []);
  const dsIds = new Set();
  function walk(cfg) {
    if (!cfg || typeof cfg !== "object") return;
    if (typeof cfg.dataSourceId === "string" && cfg.dataSourceId.length === 36)
      dsIds.add(cfg.dataSourceId);
    for (const v of Object.values(cfg)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
  }
  components.forEach((c) => walk(c.config ?? {}));
  return dsIds;
}

// ── Entity maps ──────────────────────────────────────────────────────────
async function buildEntityMaps(sqldb) {
  const localRows = await sqldb`SELECT id, name FROM entities WHERE company_id = ${COMPANY}`;
  const prodSql = `SELECT coalesce(json_agg(e),'[]') AS data FROM (SELECT id, name FROM entities WHERE company_id = '${COMPANY}' ORDER BY id) e`;
  const prodR = await mcp("migration_query_readonly", { sql: prodSql });
  const prodRows = prodR.rows?.[0]?.data ?? [];
  return {
    local: { byName: new Map(localRows.map((r) => [r.name, r.id])) },
    prod: { byId: new Map(prodRows.map((r) => [r.id, r.name])) },
  };
}

function translateEntityId(id, prodById, localByName) {
  if (!id) return id;
  const name = prodById.get(id);
  if (!name) return id;
  return localByName.get(name) ?? id;
}

function translateDsConfig(cfg, prodById, localByName) {
  if (!cfg) return cfg;
  const tr = (id) => translateEntityId(id, prodById, localByName);
  return {
    ...cfg,
    baseEntityId: tr(cfg.baseEntityId),
    relations: (cfg.relations ?? []).map((r) => ({ ...r, targetEntityId: tr(r.targetEntityId) })),
    aggregates: (cfg.aggregates ?? []).map((a) => ({
      ...a,
      targetEntityId: tr(a.targetEntityId),
      ...(a.via ? { via: { ...a.via, farEntityId: tr(a.via.farEntityId) } } : {}),
    })),
    fields: (cfg.fields ?? []).map((f) => ({
      ...f,
      ...(f.ref ? { ref: tr(f.ref) } : {}),
    })),
  };
}

// ── Pull datasources from prod ────────────────────────────────────────────
async function pullDatasources(dsIds, entityMaps, sqldb) {
  if (dsIds.size === 0) return;
  const ids = [...dsIds];
  const sql = `SELECT coalesce(json_agg(d),'[]') AS data FROM (SELECT id, name, label, icon, config FROM datasources WHERE company_id = '${COMPANY}' AND id IN (${ids.map((id) => `'${id}'`).join(",")}) ORDER BY id) d`;
  const r = await mcp("migration_query_readonly", { sql });
  const rows = r.rows?.[0]?.data ?? [];

  for (const ds of rows) {
    const cfg = translateDsConfig(ds.config, entityMaps.prod.byId, entityMaps.local.byName);
    // Xoá bản local trùng TÊN nhưng khác id (thay bằng prod UUID).
    await sqldb`
      DELETE FROM datasources
      WHERE company_id = ${COMPANY} AND lower(name) = lower(${ds.name}) AND id <> ${ds.id}`;
    await sqldb`
      INSERT INTO datasources (id, company_id, name, label, icon, config, updated_at)
      VALUES (${ds.id}, ${COMPANY}, ${ds.name}, ${ds.label}, ${ds.icon ?? null},
              ${sqldb.json(cfg)}, now())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, label = EXCLUDED.label, icon = EXCLUDED.icon,
        config = EXCLUDED.config, updated_at = now()`;
    console.log(`   [DS] ↓ ${ds.name} [${ds.id.slice(0, 8)}]`);
  }

  const notFound = ids.filter((id) => !rows.find((d) => d.id === id));
  if (notFound.length)
    console.log(
      `   [DS] ⚠ ${notFound.length} DS trong trang không tìm thấy prod: ${notFound.map((id) => id.slice(0, 8)).join(", ")}`,
    );
}

// ── Main ─────────────────────────────────────────────────────────────────
const sqldb = postgres(LOCAL, { max: 1 });
try {
  console.log("1) Kéo pages từ prod…");
  const prod = await fetchProdPages();
  const prodIds = new Set(prod.map((p) => p.id));
  const prodNames = prod.map((p) => p.name);

  // Collect all datasource IDs referenced across all prod pages
  const allDsIds = new Set();
  if (!NO_DEPS) {
    for (const p of prod) {
      const ids = extractDsIds(p.content);
      for (const id of ids) allDsIds.add(id);
    }
  }

  console.log("2) Trạng thái local trước khi sync…");
  const before = await sqldb`SELECT id, name FROM pages WHERE company_id = ${COMPANY}`;
  const beforeIds = new Set(before.map((r) => r.id));
  const newOnes = prod.filter((p) => !beforeIds.has(p.id)).length;
  const updated = prod.length - newOnes;
  const localOnly = before.filter((r) => !prodIds.has(r.id));
  console.log(`   local: ${before.length} trang | sẽ THÊM ${newOnes}, GHI ĐÈ ${updated}.`);
  if (!NO_DEPS && allDsIds.size)
    console.log(`   sẽ đồng bộ ${allDsIds.size} datasource phụ thuộc.`);

  // ── Pull datasources trước (local cần DS với prod UUID khi đọc page) ──
  if (!NO_DEPS && allDsIds.size) {
    console.log("3) Đồng bộ datasource phụ thuộc về local…");
    const entityMaps = await buildEntityMaps(sqldb);
    console.log(
      `   local ${entityMaps.local.byName.size} entity · prod ${entityMaps.prod.byId.size} entity`,
    );
    await pullDatasources(allDsIds, entityMaps, sqldb);
  }

  const step = !NO_DEPS && allDsIds.size ? "4" : "3";
  console.log(`${step}) Upsert pages (prod wins)…`);
  await sqldb.begin(async (tx) => {
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
