/* sync-pages.mjs — Đồng bộ bảng `pages` (+ datasources phụ thuộc)
   giữa DB dev local và PROD, lấy PROD làm hub chung (UUID toàn cục).

   Chế độ:
   ─ MẶC ĐỊNH (2 chiều): so timestamp → bên mới hơn thắng; content trùng → SKIP.
   ─ --push  (1 chiều, ghi đè): BỎ QUA so sánh, luôn ĐẨY local → prod (local wins).
   ─ --pull  (1 chiều, ghi đè): BỎ QUA so sánh, luôn KÉO prod → local (prod wins).
   Hai flag loại trừ nhau. Kết hợp với --only để giới hạn phạm vi.

   Quy tắc per-page chế độ 2 chiều (mặc định):
   - cùng id 2 bên: bên nào updated_at MỚI HƠN thắng → PUSH / PULL; bằng nhau → SKIP.
   - chỉ có ở PROD → PULL về local.
   - chỉ có ở LOCAL:
       · tên `<base>_<id6>` mà prod đã có trang cùng <base> khác id → STRAY → BÁO, bỏ.
       · còn lại = trang MỚI thật → PUSH (insert giữ id).
   - Trang đã xoá mềm (deleted_at) → BỎ QUA.

   Kèm đồng bộ DATASOURCE phụ thuộc:
   - PUSH trang → PUSH các datasource trang đó dùng (dịch entity ID local→prod theo tên).
     Page content được cập nhật DS UUID → prod UUID trước khi đẩy.
   - PULL trang → PULL các datasource trang đó dùng (dịch entity ID prod→local theo tên).
     DS kéo về local giữ nguyên PROD UUID (prod-as-hub) → page content hoạt động.

   MẶC ĐỊNH = DRY (chỉ in kế hoạch). Thêm --apply để thực thi.
     node tooling/migration-cli/src/sync-pages.mjs                                    # 2 chiều, dry
     node tooling/migration-cli/src/sync-pages.mjs --apply                            # 2 chiều, thực thi
     node tooling/migration-cli/src/sync-pages.mjs --push --apply                     # local wins tất cả
     node tooling/migration-cli/src/sync-pages.mjs --pull --apply                     # prod wins tất cả
     node tooling/migration-cli/src/sync-pages.mjs --push --only mau_sac,khach_hang --apply
     node tooling/migration-cli/src/sync-pages.mjs --no-deps --apply                  # bỏ qua sync DS

   ⚠ So sánh theo updated_at; lệch đồng hồ máy dev vs prod → chọn nhầm "mới hơn".
*/
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const COMPANY = "00000000-0000-0000-0000-000000000001";
const URL = "https://erp.vfmgroup.vn/mcp/migration";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const NO_DEPS = argv.includes("--no-deps");
const FORCE_PUSH = argv.includes("--push"); // 1 chiều: local luôn thắng
const FORCE_PULL = argv.includes("--pull"); // 1 chiều: prod luôn thắng
if (FORCE_PUSH && FORCE_PULL) {
  console.error("Lỗi: --push và --pull loại trừ nhau.");
  process.exit(1);
}
const onlyIdx = argv.indexOf("--only");
const ONLY = new Set(
  onlyIdx >= 0 && argv[onlyIdx + 1]
    ? argv[onlyIdx + 1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [],
);

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
  const cfg = JSON.parse(readFileSync(join(homedir(), ".claude.json"), "utf8"));
  const proj = cfg.projects?.["D:/code/cowok/Apps/erp-framework"];
  const servers = { ...(cfg.mcpServers ?? {}), ...(proj?.mcpServers ?? {}) };
  for (const n of ["erp-migration", "erp-feedback"]) {
    const k = servers[n]?.headers?.["X-API-Key"];
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

// ── Page fetch ──────────────────────────────────────────────────────────
const SELECT_COLS =
  "id, name, label, icon, content, published, publish_mode, " +
  "to_char(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS.MS') AS updated_at";

async function fetchProdPages() {
  const out = [];
  const LIMIT = 50;
  let lastId = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const sql = `SELECT coalesce(json_agg(p), '[]'::json) AS data FROM (SELECT ${SELECT_COLS} FROM pages WHERE company_id = '${COMPANY}' AND deleted_at IS NULL AND id > '${lastId}' ORDER BY id LIMIT ${LIMIT}) p`;
    const r = await mcp("migration_query_readonly", { sql });
    const data = r.rows?.[0]?.data ?? [];
    if (data.length === 0) break;
    out.push(...data);
    lastId = data.reduce((m, p) => (p.id > m ? p.id : m), lastId);
    if (data.length < LIMIT) break;
  }
  return out;
}

// ── Entity maps (tên → id) cho dịch UUID cross-env ──────────────────────
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

// ── Trích entity IDs và datasource IDs trong page content ────────────────
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
  for (const c of components) walk(c.config ?? {});
  return { entityIds, dsIds };
}

// ── Dịch entity UUID trong config datasource (bằng tên làm khóa) ─────────
function translateEntityId(id, fromById, toByName) {
  if (!id) return id;
  const name = fromById.get(id);
  if (!name) return id; // entity chưa biết → giữ nguyên
  return toByName.get(name) ?? id; // không tìm thấy trên target → giữ nguyên
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
    // fields[].ref là entity UUID (lookup master) — dịch nếu có
    fields: (cfg.fields ?? []).map((f) => ({
      ...f,
      ...(f.ref ? { ref: tr(f.ref) } : {}),
    })),
  };
}

// ── Dịch UUID trong page content ─────────────────────────────────────────
function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function translatePageConfig(value, translateEntity, translateDs, key = "") {
  if (Array.isArray(value)) return value.map((v) => translatePageConfig(v, translateEntity, translateDs));
  if (!value || typeof value !== "object") {
    if (!isUuid(value)) return value;
    return key === "dataSourceId" ? translateDs(value) : translateEntity(value);
  }
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      translatePageConfig(v, translateEntity, translateDs, k),
    ]),
  );
}

function translatePageContent(content, translateEntity, translateDs) {
  const translateComp = (comp) => {
    const cfg = comp.config;
    if (!cfg) return comp;
    return {
      ...comp,
      config: translatePageConfig(cfg, translateEntity, translateDs),
    };
  };
  if (Array.isArray(content)) return content.map(translateComp);
  if (content && typeof content === "object" && "components" in content)
    return { ...content, components: (content.components ?? []).map(translateComp) };
  return content;
}

// ── Đẩy datasources phụ thuộc LÊN PROD (PUSH direction) ─────────────────
// Trả về Map: local_ds_id → prod_ds_id
async function pushDatasources(dsIds, entityMaps, sqldb) {
  if (dsIds.size === 0) return new Map();
  const ids = [...dsIds];
  const localRows = await sqldb`
    SELECT id, name, label, icon, config
    FROM datasources
    WHERE company_id = ${COMPANY} AND id = ANY(${ids})`;

  const localIdToProdId = new Map();
  const notFound = ids.filter((id) => !localRows.find((r) => r.id === id));

  // Datasource có trong page content nhưng KHÔNG tìm thấy local: có thể đã dùng prod UUID
  // (trang được pull từ prod và DS cũng đã tồn tại trên prod). Kiểm tra prod theo id.
  if (notFound.length) {
    const sqlCheck = `SELECT coalesce(json_agg(d),'[]') AS data FROM (SELECT id, name FROM datasources WHERE company_id = '${COMPANY}' AND id IN (${notFound.map((id) => `'${id}'`).join(",")}) ORDER BY id) d`;
    const r = await mcp("migration_query_readonly", { sql: sqlCheck });
    const prodHas = r.rows?.[0]?.data ?? [];
    for (const ds of prodHas) {
      // DS này đã tồn tại trên prod với cùng UUID → ID đã đúng, không cần dịch
      localIdToProdId.set(ds.id, ds.id);
    }
    const stillMissing = notFound.filter((id) => !prodHas.find((d) => d.id === id));
    if (stillMissing.length) {
      console.log(
        `  [DS] ⚠ ${stillMissing.length} datasource trong trang không tìm thấy cả local lẫn prod — bỏ qua: ${stillMissing.map((id) => id.slice(0, 8)).join(", ")}`,
      );
    }
  }

  for (const ds of localRows) {
    const translatedCfg = translateDsConfig(
      ds.config,
      entityMaps.local.byId,
      entityMaps.prod.byName,
    );
    if (!APPLY) {
      console.log(`  [DS] sẽ đẩy: ${ds.name} [${ds.id.slice(0, 8)}]`);
      // Trong DRY, dùng id gốc làm placeholder
      localIdToProdId.set(ds.id, ds.id);
      continue;
    }
    const r = await mcp("datasource_create_draft", {
      name: ds.name,
      label: ds.label,
      ...(ds.icon ? { icon: ds.icon } : {}),
      config: translatedCfg,
      overwrite: true,
    });
    const prodId = r.dataSourceId;
    localIdToProdId.set(ds.id, prodId);
    const mark = r.status === "overwritten" ? "↑" : r.status === "created" ? "✚" : "≈";
    console.log(
      `  [DS] ${mark} ${ds.name} [local ${ds.id.slice(0, 8)} → prod ${prodId?.slice(0, 8)}] — ${r.status}`,
    );
  }

  return localIdToProdId;
}

// ── Kéo datasources phụ thuộc VỀ LOCAL (PULL direction) ──────────────────
// DS lưu với PROD UUID (prod-as-hub) → page content (prod UUIDs) dùng được
async function pullDatasources(dsIds, entityMaps, sqldb) {
  if (dsIds.size === 0) return;
  const ids = [...dsIds];
  const sql = `SELECT coalesce(json_agg(d),'[]') AS data FROM (SELECT id, name, label, icon, config FROM datasources WHERE company_id = '${COMPANY}' AND id IN (${ids.map((id) => `'${id}'`).join(",")}) ORDER BY id) d`;
  const r = await mcp("migration_query_readonly", { sql });
  const rows = r.rows?.[0]?.data ?? [];

  if (!APPLY) {
    for (const ds of rows) console.log(`  [DS] sẽ pull: ${ds.name} [${ds.id.slice(0, 8)}]`);
    const notFound = ids.filter((id) => !rows.find((d) => d.id === id));
    if (notFound.length)
      console.log(
        `  [DS] ⚠ ${notFound.length} DS không tìm thấy trên prod: ${notFound.map((id) => id.slice(0, 8)).join(", ")}`,
      );
    return;
  }

  for (const ds of rows) {
    const translatedCfg = translateDsConfig(
      ds.config,
      entityMaps.prod.byId,
      entityMaps.local.byName,
    );
    // Nếu local đã có DS cùng tên nhưng khác id → xoá bản cũ (thay bằng prod UUID).
    await sqldb`
      DELETE FROM datasources
      WHERE company_id = ${COMPANY}
        AND lower(name) = lower(${ds.name})
        AND id <> ${ds.id}`;
    // Upsert theo id (prod UUID).
    await sqldb`
      INSERT INTO datasources (id, company_id, name, label, icon, config, updated_at)
      VALUES (${ds.id}, ${COMPANY}, ${ds.name}, ${ds.label}, ${ds.icon ?? null},
              ${sqldb.json(translatedCfg)}, now())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, label = EXCLUDED.label, icon = EXCLUDED.icon,
        config = EXCLUDED.config, updated_at = now()`;
    console.log(`  [DS] ↓ ${ds.name} [${ds.id.slice(0, 8)}]`);
  }

  const notFound = ids.filter((id) => !rows.find((d) => d.id === id));
  if (notFound.length)
    console.log(
      `  [DS] ⚠ ${notFound.length} DS trong trang không tìm thấy prod (DS bị xoá?): ${notFound.map((id) => id.slice(0, 8)).join(", ")}`,
    );
}

// ── Stray detection ──────────────────────────────────────────────────────
const baseName = (n) => n.replace(/_[0-9a-f]{6,}$/i, "");
const inScope = (name) => ONLY.size === 0 || ONLY.has(name);

const same = (a, b) =>
  a.label === b.label &&
  (a.icon ?? null) === (b.icon ?? null) &&
  a.published === b.published &&
  JSON.stringify(a.content) === JSON.stringify(b.content);

// ── Main ─────────────────────────────────────────────────────────────────
const sqldb = postgres(LOCAL, { max: 1 });
try {
  const modeLabel = FORCE_PUSH
    ? "1 CHIỀU ↑ PUSH (local ghi đè prod)"
    : FORCE_PULL
      ? "1 CHIỀU ↓ PULL (prod ghi đè local)"
      : "2 CHIỀU (so timestamp)";
  console.log(
    `Đồng bộ pages + datasources — ${modeLabel} — ${APPLY ? "APPLY" : "DRY (xem trước)"}`,
  );
  if (ONLY.size) console.log(`  --only: ${[...ONLY].join(", ")}`);
  if (NO_DEPS) console.log(`  --no-deps: bỏ qua đồng bộ datasource`);

  const prod = await fetchProdPages();
  const local = await sqldb`
    SELECT id, name, label, icon, content, published, publish_mode,
      to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS updated_at
    FROM pages WHERE company_id = ${COMPANY} AND deleted_at IS NULL`;
  console.log(`  prod ${prod.length} trang · local ${local.length} trang`);

  const prodById = new Map(prod.map((p) => [p.id, p]));
  const localById = new Map(local.map((p) => [p.id, p]));
  const prodBaseToIds = new Map();
  for (const p of prod) {
    const b = baseName(p.name);
    (prodBaseToIds.get(b) ?? prodBaseToIds.set(b, new Set()).get(b)).add(p.id);
  }

  const toPush = [];
  const toPull = [];
  const strays = [];
  const conflicts = [];
  let skip = 0;

  const ids = new Set([...prodById.keys(), ...localById.keys()]);
  for (const id of ids) {
    const lp = localById.get(id);
    const pp = prodById.get(id);

    if (FORCE_PUSH) {
      // 1 chiều: local wins → đẩy mọi trang local trong scope (bỏ qua so sánh).
      if (!lp || !inScope(lp.name)) continue;
      const clash = !pp && prodBaseToIds.get(baseName(lp.name));
      if (clash && clash.size > 0) strays.push(lp);
      else toPush.push({ p: lp, why: pp ? "ghi đè prod" : "mới ở local" });
    } else if (FORCE_PULL) {
      // 1 chiều: prod wins → kéo mọi trang prod trong scope (bỏ qua so sánh).
      if (!pp || !inScope(pp.name)) continue;
      toPull.push({ p: pp, why: lp ? "ghi đè local" : "mới ở prod" });
    } else {
      // 2 chiều: so timestamp / content.
      if (lp && pp) {
        if (!inScope(lp.name) && !inScope(pp.name)) continue;
        if (same(lp, pp)) skip++;
        else if (lp.updated_at > pp.updated_at) toPush.push({ p: lp, why: "local mới hơn" });
        else if (pp.updated_at > lp.updated_at) toPull.push({ p: pp, why: "prod mới hơn" });
        else conflicts.push(lp);
      } else if (pp && !lp) {
        if (inScope(pp.name)) toPull.push({ p: pp, why: "mới ở prod" });
      } else if (lp && !pp) {
        if (!inScope(lp.name)) continue;
        const clash = prodBaseToIds.get(baseName(lp.name));
        if (clash && clash.size > 0) strays.push(lp);
        else toPush.push({ p: lp, why: "mới ở local" });
      }
    }
  }

  console.log(
    `\nKế hoạch: PUSH ${toPush.length} · PULL ${toPull.length} · STRAY ${strays.length} · CONFLICT ${conflicts.length} · SKIP(trùng) ${skip}`,
  );
  for (const { p, why } of toPush)
    console.log(`  ↑ PUSH  ${p.name} [${p.id.slice(0, 8)}] (${why})`);
  for (const { p, why } of toPull)
    console.log(`  ↓ PULL  ${p.name} [${p.id.slice(0, 8)}] (${why})`);
  for (const p of strays)
    console.log(
      `  ⚠ STRAY ${p.name} [${p.id.slice(0, 8)}] — prod có "${baseName(p.name)}" id khác → xoá local rồi PULL`,
    );
  for (const p of conflicts)
    console.log(
      `  ⁉ CONFLICT ${p.name} [${p.id.slice(0, 8)}] — cùng giờ, khác nội dung → tự quyết`,
    );

  // ── Phân tích dependency (DS + entity) ───────────────────────────────
  const pushDsIds = new Set();
  const pullDsIds = new Set();
  for (const { p } of toPush) {
    const { dsIds } = extractPageRefs(p.content);
    for (const id of dsIds) pushDsIds.add(id);
  }
  for (const { p } of toPull) {
    const { dsIds } = extractPageRefs(p.content);
    for (const id of dsIds) pullDsIds.add(id);
  }
  if (!NO_DEPS) {
    if (pushDsIds.size)
      console.log(`\n  [DS] ${pushDsIds.size} datasource cần PUSH (phụ thuộc trang ↑)`);
    if (pullDsIds.size)
      console.log(`  [DS] ${pullDsIds.size} datasource cần PULL (phụ thuộc trang ↓)`);
  }

  if (!APPLY) {
    console.log("\n(DRY) Chưa thực thi. Thêm --apply để chạy.");
    if (!NO_DEPS && (pushDsIds.size || pullDsIds.size)) {
      // Build entity maps để hiện thêm thông tin DS trong DRY
      try {
        const entityMaps = await buildEntityMaps(sqldb);
        if (pushDsIds.size) await pushDatasources(pushDsIds, entityMaps, sqldb);
        if (pullDsIds.size) await pullDatasources(pullDsIds, entityMaps, sqldb);
      } catch (e) {
        console.log(`  [DS] Bỏ qua preview DS (${e.message})`);
      }
    }
  } else {
    // ── Build entity maps ────────────────────────────────────────────
    let entityMaps = {
      local: { byId: new Map(), byName: new Map() },
      prod: { byId: new Map(), byName: new Map() },
    };
    if (!NO_DEPS && (pushDsIds.size || pullDsIds.size)) {
      console.log("\n[Bước 1] Đọc entity maps (local + prod)…");
      entityMaps = await buildEntityMaps(sqldb);
      console.log(
        `  local ${entityMaps.local.byId.size} entity · prod ${entityMaps.prod.byId.size} entity`,
      );
    }

    // ── PUSH datasources trước (để trang đẩy lên prod dùng đúng DS UUID) ──
    let localDsIdToProdDsId = new Map();
    if (!NO_DEPS && pushDsIds.size) {
      console.log("\n[Bước 2] Đẩy datasource phụ thuộc lên prod…");
      localDsIdToProdDsId = await pushDatasources(pushDsIds, entityMaps, sqldb);
    }

    // ── PUSH pages ────────────────────────────────────────────────────
    if (toPush.length) {
      console.log("\n[Bước 3] Đẩy trang lên prod…");
    }
    let pushed = 0;
    let conflict = 0;
    for (const { p } of toPush) {
      // Dịch page content: entity UUID (local→prod theo tên) + DS UUID (local→prod qua map)
      let content = p.content;
      if (typeof content === "string") {
        try {
          content = JSON.parse(content);
        } catch (e) {
          console.error("Lỗi parse JSON content:", e);
        }
      }
      if (!NO_DEPS) {
        const trEntity = (id) =>
          translateEntityId(id, entityMaps.local.byId, entityMaps.prod.byName);
        const trDs = (id) => localDsIdToProdDsId.get(id) ?? id;
        const translated = translatePageContent(content, trEntity, trDs);
        // Chỉ dùng bản dịch nếu có thay đổi thật sự (tránh ghi khi không cần)
        if (JSON.stringify(translated) !== JSON.stringify(content)) {
          content = translated;
        }
      }
      // MCP prod co the dang chay phien ban cu (chi chap nhan mang thuon).
      // Neu content la {meta, components} thi thu nguyen; neu bi tu choi thi fallback mang.
      let mcpContent = content;
      if (!Array.isArray(content) && Array.isArray(content?.components)) {
        mcpContent = content.components;
      }
      const r = await mcp("page_create_draft", {
        id: p.id,
        name: p.name,
        label: p.label,
        icon: p.icon ?? undefined,
        content: mcpContent,
        overwrite: true,
        overwritePublished: true,
      });
      if (r.status === "name_conflict") {
        conflict++;
        console.log(
          `  ✗ PUSH ${p.name}: name_conflict (prod có tên này ở id ${String(r.pageId).slice(0, 8)})`,
        );
      } else {
        pushed++;
        console.log(`  ↑ ${p.name} → ${r.status}`);
        // Cập nhật local page content sang bản đã dịch (prod UUIDs) để lần sau so sánh đúng
        if (!NO_DEPS && JSON.stringify(content) !== JSON.stringify(p.content)) {
          await sqldb`
            UPDATE pages SET content = ${sqldb.json(content)}, updated_at = now()
            WHERE id = ${p.id} AND company_id = ${COMPANY}`;
        }
      }
    }

    // ── PULL datasources trước khi pull trang (local cần DS với prod UUID) ──
    if (!NO_DEPS && pullDsIds.size) {
      console.log("\n[Bước 4] Kéo datasource phụ thuộc về local…");
      await pullDatasources(pullDsIds, entityMaps, sqldb);
    }

    // ── PULL pages ────────────────────────────────────────────────────
    if (toPull.length) {
      console.log("\n[Bước 5] Kéo trang về local…");
    }
    let pulled = 0;
    if (toPull.length) {
      const pullPages = toPull.map((x) => x.p);
      const pullNames = pullPages.map((p) => p.name);
      const pullIds = pullPages.map((p) => p.id);
      await sqldb.begin(async (tx) => {
        await tx`DELETE FROM pages WHERE company_id = ${COMPANY} AND deleted_at IS NULL
                 AND name = ANY(${pullNames}) AND id <> ALL(${pullIds})`;
        for (const p of pullPages) {
          // Page content từ prod đã dùng prod DS UUID → không cần dịch DS UUID.
          // Dịch entity UUID prod→local nếu khác (thông thường giống nhau).
          let content = p.content;
          if (typeof content === "string") {
            try {
              content = JSON.parse(content);
            } catch (e) {
              console.error("Lỗi parse JSON content:", e);
            }
          }
          if (!NO_DEPS && entityMaps.prod.byId.size) {
            const trEntity = (id) =>
              translateEntityId(id, entityMaps.prod.byId, entityMaps.local.byName);
            const trDs = (id) => id; // DS UUID giữ nguyên prod UUID
            const translated = translatePageContent(content, trEntity, trDs);
            if (JSON.stringify(translated) !== JSON.stringify(content)) content = translated;
          }
          await tx`
            INSERT INTO pages (id, company_id, name, label, icon, content, published, publish_mode, updated_at)
            VALUES (${p.id}, ${COMPANY}, ${p.name}, ${p.label}, ${p.icon},
                    ${tx.json(content)}, ${p.published}, ${p.publish_mode ?? "private"}, now())
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name, label = EXCLUDED.label, icon = EXCLUDED.icon,
              content = EXCLUDED.content, published = EXCLUDED.published,
              publish_mode = EXCLUDED.publish_mode, updated_at = now()`;
          pulled++;
          console.log(`  ↓ ${p.name} [${p.id.slice(0, 8)}]`);
        }
      });
    }

    console.log(
      `\n✓ XONG. pushed=${pushed}, pulled=${pulled}, name_conflict=${conflict}, stray(bỏ)=${strays.length}, conflict(bỏ)=${conflicts.length}, skip(trùng)=${skip}.`,
    );
    if (strays.length)
      console.log(
        "  ⚠ STRAY chưa xử: xoá local các trang đó rồi chạy lại để PULL bản chuẩn từ prod.",
      );
  }
} finally {
  await sqldb.end();
}
