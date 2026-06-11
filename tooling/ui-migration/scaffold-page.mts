/* ==========================================================
   scaffold-page.mts — Phase 2: sinh page DRAFT từ forms.yaml (analyze-form).

   Mỗi pageCluster (các form cùng bộ data-entity = 1 màn hình) → 1 page:
   - list widget (12×5): entity chính, cột đúng thứ tự grid WinForms,
     selectionStateKey "sel" (master)
   - detail widget (6×5): xem record đang chọn (recordIdFromState "sel")
   - form widget (6×5): thêm mới
   - html widget cuối: provenance (form gốc, buttons, procs cần port — TODO
     cho người tinh chỉnh trong PageDesigner)

   Chạy (cwd = packages/server):
     MCP_KEY=sk_xxx npx tsx ../../tooling/ui-migration/scaffold-page.mts <module> [--apply]
   Mặc định chỉ in preview + ghi JSON; --apply gọi MCP page_create_draft
   (page published=false — người dùng không thấy đến khi publish).
   ========================================================== */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(new URL("../../packages/server/package.json", import.meta.url));
const YAML = require("yaml") as typeof import("yaml");

const ERP_ROOT = "D:/code/cowok/Apps/erp-framework";
const MCP_URL = "https://erp.vfmgroup.vn/mcp/migration";
const moduleName = process.argv[2];
const APPLY = process.argv.includes("--apply");
const KEY = process.env.MCP_KEY ?? "";
if (!moduleName) {
  console.error("Cách dùng: MCP_KEY=sk_x npx tsx scaffold-page.mts <module> [--apply]");
  process.exit(1);
}

async function mcp(name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY, "user-agent": "curl/8.0" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const j = (await res.json()) as {
    result?: { content: Array<{ text: string }> };
    error?: { message: string };
  };
  if (j.error) throw new Error(`MCP ${name}: ${j.error.message}`);
  return JSON.parse(j.result?.content[0]?.text ?? "null");
}

/* ── Dữ liệu vào ── */
interface FormEntry {
  form: string;
  title: string;
  inScope: boolean;
  entities: string[];
  grid?: { columns?: Array<{ field: string; header: string }> };
  buttons?: Array<{ control: string; caption: string }>;
  procs?: string[];
}
const formsDoc = YAML.parse(
  readFileSync(join(ERP_ROOT, `migration-plan/ui/${moduleName}.forms.yaml`), "utf8"),
) as { pageClusters: Array<{ entities: string[]; forms: string[] }>; forms: FormEntry[] };
const formByName = new Map(formsDoc.forms.map((f) => [f.form, f]));

// Field của entity (từ plan import — entityName = tên bảng nguồn).
const plan = JSON.parse(
  readFileSync(join(ERP_ROOT, "migration-plan-final-2026-06-11.json"), "utf8"),
) as { importItems: Array<{ tableName: string; fields: Array<{ name: string }> }> };
const fieldsByEntity = new Map<string, string[]>();
for (const it of plan.importItems) {
  const t = it.tableName.toLowerCase().replace(/^dbo\./, "");
  fieldsByEntity.set(
    t,
    it.fields.map((f) => f.name.toLowerCase()),
  );
}

/* ── Sinh page cho 1 cluster ── */
function snake(s: string): string {
  return s
    .replace(/^frm_?/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function buildPage(
  cluster: { entities: string[]; forms: string[] },
  entityIdByName: Map<string, string>,
): { name: string; label: string; content: Array<Record<string, unknown>> } | null {
  const entries = cluster.forms
    .map((f) => formByName.get(f))
    .filter((f): f is FormEntry => !!f && f.inScope);
  if (entries.length === 0) return null;
  // Form đại diện = nhiều cột grid nhất.
  const rep = entries.reduce((a, b) =>
    (b.grid?.columns?.length ?? 0) > (a.grid?.columns?.length ?? 0) ? b : a,
  );
  const gridCols = (rep.grid?.columns ?? []).map((c) => c.field);

  // Entity chính = chứa nhiều cột grid nhất; fallback entity đầu.
  let primary = cluster.entities[0]!;
  let bestHit = -1;
  for (const e of cluster.entities) {
    const fset = new Set(fieldsByEntity.get(e) ?? []);
    const hit = gridCols.filter((c) => fset.has(c)).length;
    if (hit > bestHit) {
      bestHit = hit;
      primary = e;
    }
  }
  const primaryId = entityIdByName.get(primary);
  if (!primaryId) return null;

  const fset = new Set(fieldsByEntity.get(primary) ?? []);
  let listFields = gridCols.filter((c) => fset.has(c));
  if (listFields.length < 3) listFields = (fieldsByEntity.get(primary) ?? []).slice(0, 10);
  listFields = [...new Set(listFields)].slice(0, 14);

  const title = rep.title || rep.form;
  const buttons = entries.flatMap((e) => e.buttons ?? []).filter((b) => b.caption);
  const procs = [...new Set(entries.flatMap((e) => e.procs ?? []))];
  const todoHtml = `<div style="font:12px sans-serif;color:#888;padding:8px">
<b>Scaffold từ DQHF</b> — form gốc: ${cluster.forms.join(", ")}<br/>
Nút cần gắn action: ${buttons.map((b) => b.caption).join(" · ") || "(không)"}<br/>
Proc cần port: ${procs.join(", ") || "(không)"}<br/>
Entity phụ (lookup/filter cân nhắc thêm): ${cluster.entities.filter((e) => e !== primary).join(", ") || "(không)"}
</div>`;

  const content: Array<Record<string, unknown>> = [
    {
      id: "w_list",
      kind: "list",
      x: 0,
      y: 0,
      w: 12,
      h: 5,
      config: {
        entity: primaryId,
        title,
        fields: listFields,
        selectionStateKey: "sel",
        pageSize: 25,
      },
    },
    {
      id: "w_detail",
      kind: "detail",
      x: 0,
      y: 5,
      w: 6,
      h: 5,
      config: { entity: primaryId, recordIdFromState: "sel", title: "Chi tiết" },
    },
    {
      id: "w_form",
      kind: "form",
      x: 6,
      y: 5,
      w: 6,
      h: 5,
      config: { entity: primaryId, title: "Thêm mới" },
    },
    { id: "w_todo", kind: "html", x: 0, y: 10, w: 12, h: 2, config: { html: todoHtml } },
  ];

  return { name: `dq_${moduleName}_${snake(rep.form)}`.slice(0, 60), label: title, content };
}

/* ── Main ── */
const main = async () => {
  if (!KEY) {
    console.error("Thiếu env MCP_KEY");
    process.exit(1);
  }
  const ents = (await mcp("entity_list", {})) as Array<{ id: string; name: string }>;
  const entityIdByName = new Map(ents.map((e) => [e.name.toLowerCase(), e.id]));

  const outDir = join(ERP_ROOT, `migration-plan/ui/pages/${moduleName}`);
  mkdirSync(outDir, { recursive: true });

  let created = 0;
  let skipped = 0;
  for (const cluster of formsDoc.pageClusters) {
    const page = buildPage(cluster, entityIdByName);
    if (!page) {
      console.log(`  bỏ qua cluster [${cluster.entities.join(",")}] — không dựng được`);
      continue;
    }
    writeFileSync(join(outDir, `${page.name}.json`), JSON.stringify(page, null, 1), "utf8");
    if (APPLY) {
      const r = (await mcp("page_create_draft", page)) as { status: string };
      if (r.status === "created") created++;
      else skipped++;
      console.log(`  ${r.status === "created" ? "✓" : "≈"} ${page.name} — ${page.label}`);
    } else {
      console.log(`  (preview) ${page.name} — ${page.label}`);
    }
  }
  console.log(
    APPLY
      ? `Tạo ${created} page draft, ${skipped} đã tồn tại (skip).`
      : `Preview ${formsDoc.pageClusters.length} cluster → JSON tại ${outDir}. Thêm --apply để tạo.`,
  );
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
