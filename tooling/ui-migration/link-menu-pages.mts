/* ==========================================================
   link-menu-pages.mts — Link trang menu-driven ↔ node menu DQHF
   (legacy_menu_map.page_id) + publish, qua MCP menu_link_pages.
   Đọc page JSON ở migration-plan/ui/pages-menu (field _menuCodes do
   scaffold-menu ghi).

   dryRun mặc định. --apply để ghi. --publish cũng publish trang.
   Chạy (cwd packages/server):
     MIGRATION_MCP_KEY=... npx tsx ../../tooling/ui-migration/link-menu-pages.mts [--apply] [--publish]
   ========================================================== */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ERP_ROOT = "D:/code/cowok/Apps/erp-framework";
const PAGES_DIR = join(ERP_ROOT, "migration-plan/ui/pages-menu");
const MCP_URL = process.env.MIGRATION_MCP_URL ?? "https://erp.vfmgroup.vn/mcp/migration";
const KEY = process.env.MIGRATION_MCP_KEY ?? "";
if (!KEY) { console.error("Thiếu MIGRATION_MCP_KEY"); process.exit(1); }
const APPLY = process.argv.includes("--apply");
const PUBLISH = process.argv.includes("--publish");

async function mcp<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(MCP_URL, { method: "POST", headers: { "X-API-Key": KEY, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const j = (await res.json()) as { result?: { content?: Array<{ text?: string }>; isError?: boolean }; error?: { message: string } };
  if (j.error || j.result?.isError) throw new Error(j.error?.message ?? j.result?.content?.[0]?.text ?? "err");
  return JSON.parse(j.result?.content?.[0]?.text ?? "null") as T;
}

const links: Array<{ pageName: string; menuCodes: string[] }> = [];
for (const dir of readdirSync(PAGES_DIR)) {
  const sub = join(PAGES_DIR, dir);
  for (const file of readdirSync(sub).filter((f) => f.endsWith(".json"))) {
    const p = JSON.parse(readFileSync(join(sub, file), "utf8")) as { name: string; _menuCodes?: string[] };
    if (p.name && p._menuCodes?.length) links.push({ pageName: p.name, menuCodes: p._menuCodes });
  }
}
console.log(`${links.length} trang có _menuCodes (tổng ${links.reduce((s, l) => s + l.menuCodes.length, 0)} node)`);

const r = await mcp<{ linkedNodes: number; publishedPages: number; notFound: string[] }>("menu_link_pages", { links, publish: PUBLISH, dryRun: !APPLY });
console.log(`${APPLY ? "Đã link" : "Sẽ link"}: ${r.linkedNodes} node, publish ${r.publishedPages} trang. Không thấy: ${r.notFound.length}`);
if (r.notFound.length) console.log("notFound:", r.notFound.slice(0, 10).join(", "));
