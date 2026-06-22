/* sync-pages-to-prod.mjs — ĐẨY bảng `pages` + datasources phụ thuộc từ DB dev
   local (erp_sample) LÊN PROD. Giữ nguyên page UUID. Datasource đẩy theo tên
   (overwrite), entity UUID trong DS config được dịch local→prod qua tên entity.

   - CHỈ đẩy các trang nêu rõ ở --only (an toàn).
   - DS trong trang tự động được đẩy cùng trừ khi có --no-deps.
   - Thêm --dry để chỉ xem kế hoạch không thực thi.

   Chạy:
     node tooling/migration-cli/src/sync-pages-to-prod.mjs --only mau_sac_1fb987,khach_hang_813e1e
     node tooling/migration-cli/src/sync-pages-to-prod.mjs --only <tên> --dry
     node tooling/migration-cli/src/sync-pages-to-prod.mjs --only <tên> --no-deps
*/
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const COMPANY = "00000000-0000-0000-0000-000000000001";
const URL = "https://erp.vfmgroup.vn/mcp/migration";

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const NO_DEPS = argv.includes("--no-deps");
const onlyIdx = argv.indexOf("--only");
const ONLY =
  onlyIdx >= 0 && argv[onlyIdx + 1]
    ? argv[onlyIdx + 1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
if (ONLY.length === 0) {
  console.error("Thiếu --only <tên1,tên2>. Vd: --only mau_sac_1fb987,khach_hang_813e1e");
  process.exit(1);
}

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
  if (process.env.X_API_KEY) return process.env.X_API_KEY;
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

// ── Trích DS IDs + entity IDs từ page content ────────────────────────────
function extractPageRefs(content) {
  const components = Array.isArray(content) ? content : (content?.components ?? []);
  const entityIds = new Set();
  const dsIds = new Set();
  function walk(cfg) {
    if (!cfg || typeof cfg !== "object") return;
    if (typeof cfg.entity === "string" && cfg.entity.length === 36) entityIds.add(cfg.entity);
    if (typeof cfg.dataSourceId === "string" && cfg.dataSourceId.length === 36)
      dsIds.add(cfg.dataSourceId);
    for (const v of Object.values(cfg)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
  }
  components.forEach((c) => walk(c.config ?? {}));
  return { entityIds, dsIds };
}

// ── Entity maps ──────────────────────────────────────────────────────────
async function buildEntityMaps(sqldb) {
  const localRows = await sqldb`SELECT id, name FROM entities WHERE company_id = ${COMPANY}`;
  const prodSql = `SELECT coalesce(json_agg(e),'[]') AS data FROM (SELECT id, name FROM entities WHERE company_id = '${COMPANY}' ORDER BY id) e`;
  const prodR = await mcp("migration_query_readonly", { sql: prodSql });
  const prodRows = prodR.rows?.[0]?.data ?? [];
  return {
    local: {
      byId: new Map(localRows.map((r) => [r.id, r.name])),
      byName: new Map(localRows.map((r) => [r.name, r.id])),
    },
    prod: {
      byId: new Map(prodRows.map((r) => [r.id, r.name])),
      byName: new Map(prodRows.map((r) => [r.name, r.id])),
    },
  };
}

function translateEntityId(id, fromById, toByName) {
  if (!id) return id;
  const name = fromById.get(id);
  if (!name) return id;
  return toByName.get(name) ?? id;
}

function translateDsConfig(cfg, fromById, toByName) {
  if (!cfg) return cfg;
  const tr = (id) => translateEntityId(id, fromById, toByName);
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

function translatePageContent(content, translateEntity, translateDs) {
  const tc = (comp) => {
    const cfg = comp.config;
    if (!cfg) return comp;
    return {
      ...comp,
      config: {
        ...cfg,
        ...(cfg.entity ? { entity: translateEntity(cfg.entity) } : {}),
        ...(cfg.dataSourceId ? { dataSourceId: translateDs(cfg.dataSourceId) } : {}),
      },
    };
  };
  if (Array.isArray(content)) return content.map(tc);
  if (content && typeof content === "object" && "components" in content)
    return { ...content, components: (content.components ?? []).map(tc) };
  return content;
}

// ── Push datasources ─────────────────────────────────────────────────────
async function pushDatasources(dsIds, entityMaps, sqldb) {
  const ids = [...dsIds];
  const localRows = await sqldb`
    SELECT id, name, label, icon, config FROM datasources
    WHERE company_id = ${COMPANY} AND id = ANY(${ids})`;

  const idMap = new Map(); // local_id → prod_id
  const notFound = ids.filter((id) => !localRows.find((r) => r.id === id));

  if (notFound.length) {
    // Có thể DS này đã dùng prod UUID (trang pull từ prod)
    const sqlCheck = `SELECT coalesce(json_agg(d),'[]') AS data FROM (SELECT id, name FROM datasources WHERE company_id = '${COMPANY}' AND id IN (${notFound.map((id) => `'${id}'`).join(",")}) ORDER BY id) d`;
    const r = await mcp("migration_query_readonly", { sql: sqlCheck });
    for (const d of r.rows?.[0]?.data ?? []) idMap.set(d.id, d.id);
    const stillMissing = notFound.filter((id) => !idMap.has(id));
    if (stillMissing.length)
      console.log(
        `  [DS] ⚠ ${stillMissing.length} DS không tìm thấy local/prod: ${stillMissing.map((id) => id.slice(0, 8)).join(", ")}`,
      );
  }

  for (const ds of localRows) {
    const cfg = translateDsConfig(ds.config, entityMaps.local.byId, entityMaps.prod.byName);
    if (DRY) {
      console.log(`  [DS] sẽ đẩy: ${ds.name} [${ds.id.slice(0, 8)}]`);
      idMap.set(ds.id, ds.id);
      continue;
    }
    const r = await mcp("datasource_create_draft", {
      name: ds.name,
      label: ds.label,
      ...(ds.icon ? { icon: ds.icon } : {}),
      config: cfg,
      overwrite: true,
    });
    idMap.set(ds.id, r.dataSourceId);
    const mark = r.status === "overwritten" ? "↑" : r.status === "created" ? "✚" : "≈";
    console.log(
      `  [DS] ${mark} ${ds.name} [local ${ds.id.slice(0, 8)} → prod ${r.dataSourceId?.slice(0, 8)}] — ${r.status}`,
    );
  }
  return idMap;
}

// ── Main ─────────────────────────────────────────────────────────────────
const sqldb = postgres(LOCAL, { max: 1 });
try {
  console.log(`1) Đọc ${ONLY.length} trang local theo tên…`);
  const rows = await sqldb`
    SELECT id, name, label, icon, content
    FROM pages
    WHERE company_id = ${COMPANY} AND name = ANY(${ONLY})`;
  const found = new Set(rows.map((r) => r.name));
  const missing = ONLY.filter((n) => !found.has(n));
  if (missing.length) console.log(`   ⚠ KHÔNG thấy ở local (bỏ qua): ${missing.join(", ")}`);
  if (rows.length === 0) {
    console.log("Không có trang nào để đẩy.");
  } else if (DRY || NO_DEPS) {
    if (DRY) console.log("2) (--dry) Sẽ đẩy (giữ id):");
    for (const p of rows) console.log(`   - ${p.name} [${p.id}] — ${p.label}`);

    // Hiện DS sẽ được đẩy
    if (!NO_DEPS) {
      const allDsIds = new Set();
      for (const p of rows) {
        const { dsIds } = extractPageRefs(p.content);
        for (const id of dsIds) allDsIds.add(id);
      }
      if (allDsIds.size) {
        console.log(`\n   Datasource phụ thuộc (${allDsIds.size}):`);
        const localDs = await sqldb`SELECT id, name FROM datasources WHERE company_id = ${COMPANY} AND id = ANY(${[...allDsIds]})`;
        for (const ds of localDs) console.log(`   [DS] ${ds.name} [${ds.id.slice(0, 8)}]`);
        const notFoundDs = [...allDsIds].filter((id) => !localDs.find((d) => d.id === id));
        if (notFoundDs.length)
          console.log(
            `   [DS] ⚠ ${notFoundDs.length} DS không tìm thấy local (có thể đã dùng prod UUID)`,
          );
      }
    }
  } else {
    // ── Build entity maps ─────────────────────────────────────────────
    const allDsIds = new Set();
    for (const p of rows) {
      const { dsIds } = extractPageRefs(p.content);
      for (const id of dsIds) allDsIds.add(id);
    }

    let entityMaps = {
      local: { byId: new Map(), byName: new Map() },
      prod: { byId: new Map(), byName: new Map() },
    };
    let localDsIdToProdDsId = new Map();

    if (allDsIds.size) {
      console.log("2) Đọc entity maps (local + prod) để dịch DS config…");
      entityMaps = await buildEntityMaps(sqldb);
      console.log(
        `   local ${entityMaps.local.byId.size} entity · prod ${entityMaps.prod.byId.size} entity`,
      );

      console.log(`3) Đẩy ${allDsIds.size} datasource phụ thuộc lên prod…`);
      localDsIdToProdDsId = await pushDatasources(allDsIds, entityMaps, sqldb);
    }

    const step = allDsIds.size ? "4" : "2";
    console.log(`${step}) Đẩy ${rows.length} trang lên prod (page_create_draft giữ id, overwrite)…`);
    const tally = { created: 0, overwritten: 0, name_conflict: 0, skipped_exists: 0, other: 0 };
    for (const p of rows) {
      // Dịch page content: entity UUID (local→prod) + DS UUID (local→prod)
      const trEntity = (id) =>
        translateEntityId(id, entityMaps.local.byId, entityMaps.prod.byName);
      const trDs = (id) => localDsIdToProdDsId.get(id) ?? id;
      let content = p.content;
      const translated = translatePageContent(content, trEntity, trDs);
      if (JSON.stringify(translated) !== JSON.stringify(content)) content = translated;

      const r = await mcp("page_create_draft", {
        id: p.id,
        name: p.name,
        label: p.label,
        icon: p.icon ?? undefined,
        content,
        overwrite: true,
        overwritePublished: true,
      });
      const st = r?.status ?? "other";
      tally[st in tally ? st : "other"]++;
      const mark =
        st === "created" || st === "overwritten" ? "✓" : st === "name_conflict" ? "✗" : "≈";
      console.log(
        `   ${mark} ${p.name} → ${st}` +
          (st === "name_conflict" ? ` (prod đã có tên này ở id khác: ${r.pageId})` : ""),
      );
      // Cập nhật local sang prod UUIDs để lần sau không cần dịch lại
      if (JSON.stringify(content) !== JSON.stringify(p.content) && st !== "name_conflict") {
        await sqldb`UPDATE pages SET content = ${sqldb.json(content)}, updated_at = now()
                    WHERE id = ${p.id} AND company_id = ${COMPANY}`;
      }
    }
    console.log(
      `\n✓ XONG. created=${tally.created}, overwritten=${tally.overwritten}, ` +
        `name_conflict=${tally.name_conflict}, skipped=${tally.skipped_exists}, other=${tally.other}.`,
    );
    if (tally.name_conflict > 0) {
      console.log(
        "  ⚠ name_conflict: prod có trang TRÙNG TÊN nhưng KHÁC id. Dọn bản đó (MCP page_delete) rồi chạy lại.",
      );
    }
  }
} finally {
  await sqldb.end();
}
