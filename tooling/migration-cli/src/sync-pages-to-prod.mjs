/* sync-pages-to-prod.mjs — ĐẨY bảng `pages` (định nghĩa trang low-code) từ DB dev
   local (erp_sample) LÊN PROD (https://erp.vfmgroup.vn), GIỮ NGUYÊN id (UUID toàn
   cục) qua MCP `page_create_draft` (mục `id`). Mirror ngược sync-pages-from-prod.mjs.

   - Giữ id → prod UPSERT theo id: trang tồn tại → update tại chỗ (cập nhật cả tên);
     chưa có id → insert đúng id đó (không đẻ id mới) → lần sau update tại chỗ, hết
     trùng + KHÔNG phải gán menu lại (legacy_menu_map.page_id giữ nguyên).
   - CHỈ đẩy các trang nêu rõ ở --only (an toàn, tránh đẩy nhầm tất cả).
   - page_create_draft cần prod đã DEPLOY bản hỗ trợ `id`. Trùng-tên-khác-id →
     trả name_conflict (KHÔNG đè) → tự dọn bản trùng rồi chạy lại.

   Chạy:
     node tooling/migration-cli/src/sync-pages-to-prod.mjs --only mau_sac_1fb987,khach_hang_813e1e
     node tooling/migration-cli/src/sync-pages-to-prod.mjs --only <tên> --dry   (chỉ xem)
*/
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const COMPANY = "00000000-0000-0000-0000-000000000001";
const URL = "https://erp.vfmgroup.vn/mcp/migration";

// ── Tham số: --only a,b,c (bắt buộc) + --dry (xem, không đẩy) ──
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
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
  } else if (DRY) {
    console.log("2) (--dry) Sẽ đẩy (giữ id):");
    for (const p of rows) console.log(`   - ${p.name} [${p.id}] — ${p.label}`);
  } else {
    console.log("2) Đẩy lên prod (page_create_draft giữ id, overwrite)…");
    const tally = { created: 0, overwritten: 0, name_conflict: 0, skipped_exists: 0, other: 0 };
    for (const p of rows) {
      const r = await mcp("page_create_draft", {
        id: p.id,
        name: p.name,
        label: p.label,
        icon: p.icon ?? undefined,
        content: p.content,
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
    }
    console.log(
      `\n✓ XONG. created=${tally.created}, overwritten=${tally.overwritten}, ` +
        `name_conflict=${tally.name_conflict}, skipped=${tally.skipped_exists}, other=${tally.other}.`,
    );
    if (tally.name_conflict > 0) {
      console.log(
        "  ⚠ name_conflict: prod có trang TRÙNG TÊN nhưng KHÁC id (bản cũ/trùng). Dọn bản đó " +
          "(MCP page_delete) rồi chạy lại để insert đúng id.",
      );
    }
  }
} finally {
  await sqldb.end();
}
