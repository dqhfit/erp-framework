import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const KEY = process.env.ERP_MCP_KEY || process.env.X_API_KEY;
if (!KEY) throw new Error("Thiếu ERP_MCP_KEY or X_API_KEY");
const URL = "https://erp.vfmgroup.vn/mcp/migration";
const COMPANY = "00000000-0000-0000-0000-000000000001";

function localDbUrl() {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const env = readFileSync(join(root, "packages", "db", ".env"), "utf8");
    const m = env.match(/^DATABASE_URL=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch {}
  return "postgres://erp:erp@localhost:5433/erp_framework";
}
const LOCAL = localDbUrl();
const PAGE_ID = process.argv[2];
const DRY = process.argv.includes("--dry");
if (!PAGE_ID) throw new Error("Thiếu page id (argv[2])");
let rpc = 0;
async function mcp(name, args) {
  const res = await fetch(URL, { method: "POST", headers: { "X-API-Key": KEY, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpc, method: "tools/call", params: { name, arguments: args } }) });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  const t = j.result?.content?.[0]?.text ?? "";
  if (j.result?.isError) throw new Error(t);
  return t ? JSON.parse(t) : null;
}
async function q(sql) { return (await mcp("migration_query_readonly", { sql })).rows; }
const sqldb = postgres(LOCAL, { max: 1 });
try {
  const [p] = await sqldb`SELECT id,name,label,icon,content FROM pages WHERE company_id=${COMPANY} AND id=${PAGE_ID}`;
  if (!p) throw new Error("Không thấy trang ở local");
  console.log(`Local: ${p.name} [${p.id}] — ${p.label} | widgets=${Array.isArray(p.content) ? p.content.length : "(obj)"}`);
  // scan refs
  const refEnt = new Set(), refDs = new Set();
  (function scan(o) {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(scan);
    for (const [k, v] of Object.entries(o)) {
      if (k === "entity" && typeof v === "string") refEnt.add(v);
      else if (k === "dataSourceId" && typeof v === "string") refDs.add(v);
      else scan(v);
    }
  })(p.content);
  const prodRaw = await q(`SELECT name, (deleted_at IS NULL) AS live, content FROM pages WHERE id='${PAGE_ID}'`);
  const prod = prodRaw.map(r => {
    let widgets = -1;
    if (r.content) {
      widgets = Array.isArray(r.content) ? r.content.length : (r.content.components ? r.content.components.length : 0);
    }
    return { name: r.name, live: r.live, widgets };
  });
  console.log("Prod hiện tại:", JSON.stringify(prod));
  if (refEnt.size) {
    const have = new Set((await q(`SELECT id FROM entities WHERE id IN (${[...refEnt].map((x) => `'${x}'`).join(",")})`)).map((r) => r.id));
    console.log("Entity:", [...refEnt].map((id) => `${id.slice(0, 8)}:${have.has(id) ? "OK" : "THIẾU"}`).join(" | "));
  }
  if (refDs.size) {
    const have = new Set((await q(`SELECT id FROM datasources WHERE id IN (${[...refDs].map((x) => `'${x}'`).join(",")})`)).map((r) => r.id));
    console.log("Datasource:", [...refDs].map((id) => `${id.slice(0, 8)}:${have.has(id) ? "OK" : "THIẾU"}`).join(" | "));
  }
  const prodName = prod?.[0]?.name ?? p.name; // giữ tên prod nếu trang đã tồn tại (tránh đụng unique)
  if (DRY) {
    console.log(`(--dry) chưa đẩy. Sẽ giữ name = "${prodName}".`);
  } else {
    console.log("p.content is:", JSON.stringify(p.content).substring(0, 500));
    console.log("p.content type:", typeof p.content, "isArray:", Array.isArray(p.content));
    const r = await mcp("page_create_draft", { id: p.id, name: prodName, label: p.label, icon: p.icon ?? undefined, content: p.content, overwrite: true, overwritePublished: true });
    console.log("KẾT QUẢ:", JSON.stringify(r));
  }
} finally { await sqldb.end(); }
