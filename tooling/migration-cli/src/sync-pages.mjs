/* sync-pages.mjs — Đồng bộ HAI CHIỀU bảng `pages` giữa DB dev local và PROD, lấy
   PROD làm hub chung (UUID toàn cục). Hợp cho 1 người dùng NHIỀU MÁY dev: mỗi máy
   chạy `node sync-pages.mjs` là hội tụ về bản mới nhất, không lo đè nhầm.

   Quy tắc per-page (khớp theo id):
   - cùng id 2 bên: bên nào updated_at MỚI HƠN thắng → PUSH (local mới) / PULL (prod
     mới); bằng nhau → SKIP.
   - chỉ có ở PROD → PULL về local.
   - chỉ có ở LOCAL:
       · nếu trông như STRAY (tên `<base>_<id6>` mà prod đã có trang cùng <base> khác
         id) → BÁO, KHÔNG đẩy (tránh đẻ trùng); tự xoá local rồi pull bản chuẩn.
       · còn lại = trang MỚI thật → PUSH (insert giữ id; prod để published=false đến
         khi publish).
   - Trang đã xoá mềm (deleted_at) 2 bên đều BỎ QUA (xoá không tự lan — làm tay).

   PUSH qua MCP page_create_draft (giữ id, overwrite). PULL upsert thẳng vào local
   (postgres-js), tự dọn local trùng-tên-khác-id.

   MẶC ĐỊNH = DRY (chỉ in kế hoạch). Thêm --apply để thực thi.
     node tooling/migration-cli/src/sync-pages.mjs
     node tooling/migration-cli/src/sync-pages.mjs --apply
     node tooling/migration-cli/src/sync-pages.mjs --only mau_sac_8f0315,khach_hang_813e1e --apply

   ⚠ So sánh theo updated_at: lệch ĐỒNG HỒ máy dev vs prod có thể chọn nhầm "mới hơn".
   Một người nhiều máy + NTP thì ổn; KHÔNG dùng khi 2 người sửa CÙNG 1 trang đồng thời.
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

// Lấy toàn bộ pages prod (batch tránh cap ~200KB/response). updated_at dạng TEXT
// ISO (to_char) để so sánh lexical = chronological, né bẫy timezone.
const SELECT_COLS =
  "id, name, label, icon, content, published, publish_mode, " +
  "to_char(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS.MS') AS updated_at";
async function fetchProdPages() {
  // KEYSET pagination (WHERE id > lastId) — KHÔNG dùng OFFSET: prod bị sửa đồng
  // thời (nhiều máy) làm OFFSET trôi → bỏ sót/lặp trang. Keyset ổn định: trang xoá
  // chỉ vắng mặt, trang thêm id>lastId vẫn lấy. lastId = MAX id batch (uuid so theo
  // chuỗi hex = đúng thứ tự uuid của PG).
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

// Tên gốc: bỏ đuôi "_<6+ hex>" (quy ước đặt tên theo id) để dò stray cùng-base-khác-id.
const baseName = (n) => n.replace(/_[0-9a-f]{6,}$/i, "");
const inScope = (name) => ONLY.size === 0 || ONLY.has(name);

const sqldb = postgres(LOCAL, { max: 1 });
try {
  console.log(`Đồng bộ 2 chiều pages (PROD hub) — chế độ ${APPLY ? "APPLY" : "DRY (xem trước)"}`);
  if (ONLY.size) console.log(`  --only: ${[...ONLY].join(", ")}`);

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

  // Trùng NỘI DUNG (label+icon+published+content) → khỏi sync. Chặn ping-pong:
  // PUSH chỉ bơm updated_at prod (không đụng local) → nếu so theo time sẽ PULL lại.
  const same = (a, b) =>
    a.label === b.label &&
    (a.icon ?? null) === (b.icon ?? null) &&
    a.published === b.published &&
    JSON.stringify(a.content) === JSON.stringify(b.content);

  const toPush = []; // {p, why} -> prod (page_create_draft giữ id)
  const toPull = []; // {p, why} -> local (upsert)
  const strays = []; // local-only nghi leftover
  const conflicts = []; // cùng updated_at nhưng khác nội dung → người dùng tự xử
  let skip = 0;

  const ids = new Set([...prodById.keys(), ...localById.keys()]);
  for (const id of ids) {
    const lp = localById.get(id);
    const pp = prodById.get(id);
    if (lp && pp) {
      if (!inScope(lp.name) && !inScope(pp.name)) continue;
      if (same(lp, pp))
        skip++; // nội dung trùng → khỏi sync
      else if (lp.updated_at > pp.updated_at) toPush.push({ p: lp, why: "local mới hơn" });
      else if (pp.updated_at > lp.updated_at) toPull.push({ p: pp, why: "prod mới hơn" });
      else conflicts.push(lp); // cùng giờ, khác nội dung
    } else if (pp && !lp) {
      if (inScope(pp.name)) toPull.push({ p: pp, why: "mới ở prod" });
    } else if (lp && !pp) {
      if (!inScope(lp.name)) continue;
      const clash = prodBaseToIds.get(baseName(lp.name));
      if (clash && clash.size > 0)
        strays.push(lp); // prod đã có base này (id khác)
      else toPush.push({ p: lp, why: "mới ở local" });
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
      `  ⚠ STRAY ${p.name} [${p.id.slice(0, 8)}] — prod có "${baseName(p.name)}" id khác → tự xoá local rồi PULL`,
    );
  for (const p of conflicts)
    console.log(
      `  ⁉ CONFLICT ${p.name} [${p.id.slice(0, 8)}] — cùng giờ, khác nội dung → tự quyết`,
    );

  if (!APPLY) {
    console.log("\n(DRY) Chưa thực thi. Thêm --apply để chạy.");
  } else {
    let pushed = 0;
    let conflict = 0;
    for (const { p } of toPush) {
      const r = await mcp("page_create_draft", {
        id: p.id,
        name: p.name,
        label: p.label,
        icon: p.icon ?? undefined,
        content: p.content,
        overwrite: true,
        overwritePublished: true,
      });
      if (r.status === "name_conflict") {
        conflict++;
        console.log(
          `  ✗ PUSH ${p.name}: name_conflict (prod có tên này ở id ${String(r.pageId).slice(0, 8)})`,
        );
      } else pushed++;
    }
    let pulled = 0;
    if (toPull.length) {
      const pullPages = toPull.map((x) => x.p);
      const pullNames = pullPages.map((p) => p.name);
      const pullIds = pullPages.map((p) => p.id);
      await sqldb.begin(async (tx) => {
        // Dọn local trùng-tên-khác-id (vỡ unique) trước khi upsert.
        await tx`DELETE FROM pages WHERE company_id = ${COMPANY} AND deleted_at IS NULL
                 AND name = ANY(${pullNames}) AND id <> ALL(${pullIds})`;
        for (const p of pullPages) {
          await tx`
            INSERT INTO pages (id, company_id, name, label, icon, content, published, publish_mode, updated_at)
            VALUES (${p.id}, ${COMPANY}, ${p.name}, ${p.label}, ${p.icon},
                    ${tx.json(p.content)}, ${p.published}, ${p.publish_mode ?? "private"}, now())
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name, label = EXCLUDED.label, icon = EXCLUDED.icon,
              content = EXCLUDED.content, published = EXCLUDED.published,
              publish_mode = EXCLUDED.publish_mode, updated_at = now()`;
          pulled++;
        }
      });
    }
    console.log(
      `\n✓ XONG. pushed=${pushed}, pulled=${pulled}, name_conflict=${conflict}, stray(bỏ)=${strays.length}, conflict(bỏ)=${conflicts.length}, skip(trùng)=${skip}.`,
    );
    if (strays.length)
      console.log(
        "  ⚠ STRAY chưa xử: xoá local các trang đó (vd qua UI/SQL) rồi chạy lại để PULL bản chuẩn từ prod.",
      );
  }
} finally {
  await sqldb.end();
}
