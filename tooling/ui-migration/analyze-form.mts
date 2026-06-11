/* ==========================================================
   analyze-form.mts — Phase 2: phân tích form WinForms DQHF → forms.yaml
   cho scaffold-page.

   Mỗi form:
   1. resolveFormProcs (legacy-menu-resolve): procs + REPO CLASS (tên repo
      = tên bảng — mảnh thiếu của pass 1 khiến 32 form danh_muc không map).
   2. Parse .Designer.cs: grid columns (DataPropertyName/FieldName +
      HeaderText/Caption), input controls (+ DataBindings), buttons.
   3. Map bảng → entity ERP (entityName = tên bảng nguồn sau re-migrate).

   Chạy (cwd = packages/server vì cần dep tsx):
     npx tsx ../../tooling/ui-migration/analyze-form.mts danh_muc
   Output: migration-plan/ui/<module>.forms.yaml
   ========================================================== */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { buildCSharpIndex, resolveFormProcs } from "../../packages/server/src/legacy-menu-resolve";

// yaml resolve qua dep của packages/server (tooling/ không có node_modules riêng).
const require = createRequire(
  new URL("../../packages/server/package.json", import.meta.url),
);
const YAML = require("yaml") as typeof import("yaml");

const DQHF_ROOT = "D:/code/DotNET/DQHF";
const ERP_ROOT = "D:/code/cowok/Apps/erp-framework";
const moduleName = process.argv[2];
if (!moduleName) {
  console.error("Cách dùng: npx tsx analyze-form.mts <module>  (vd danh_muc)");
  process.exit(1);
}

/* ── Bảng → entity ERP (sau re-migrate: entityName = tên bảng nguồn) ── */
const plan = JSON.parse(
  readFileSync(join(ERP_ROOT, "migration-plan-final-2026-06-11.json"), "utf8"),
) as {
  importItems: Array<{ tableName: string; entityName: string; fields: Array<{ name: string }> }>;
};
const erpTables = new Map<string, string>(); // "tr_nhacc" → entityName hiện tại
const fieldsByTable = new Map<string, Set<string>>(); // fingerprint match
for (const it of plan.importItems) {
  const t = it.tableName.toLowerCase().replace(/^dbo\./, "");
  erpTables.set(t, t); // sau entity_rename_to_source: entityName = tên bảng
  fieldsByTable.set(t, new Set(it.fields.map((f) => f.name.toLowerCase())));
}

/** Fallback: map qua fingerprint cột grid (DataPropertyName ≈ tên cột nguồn).
 *  Containment |grid ∩ fields| / |grid| — grid thường là TẬP CON cột bảng. */
function gridFingerprintTable(cols: GridCol[]): { table: string; score: number } | null {
  const gset = new Set(cols.map((c) => c.field).filter((f) => f && f !== "id"));
  if (gset.size < 3) return null; // quá ít cột → dễ match nhầm
  let best: { table: string; score: number } | null = null;
  for (const [t, fset] of fieldsByTable) {
    let hit = 0;
    for (const g of gset) if (fset.has(g)) hit++;
    const score = hit / gset.size;
    if (!best || score > best.score) best = { table: t, score };
  }
  return best && best.score >= 0.6 ? best : null;
}

/** Repo class → tên bảng ứng viên: TR_NHACC_BOL/TR_NHACC_DAL/TR_NHACC → tr_nhacc. */
function repoToTable(cls: string): string | null {
  const base = cls
    .toLowerCase()
    .replace(/_(bol|dal|repository|repo)$/i, "")
    .replace(/^.*\./, "");
  return erpTables.has(base) ? base : null;
}

/** Đoán bảng từ tên proc (sp_TR_X_GetAll → tr_x). */
function procToTables(procs: string[]): string[] {
  const hits = new Set<string>();
  for (const p of procs) {
    const pl = p.toLowerCase();
    for (const t of erpTables.keys()) if (pl.includes(t)) hits.add(t);
  }
  return [...hits];
}

/* ── Parse Designer.cs ── */
interface GridCol {
  field: string;
  header: string;
}
interface FormUi {
  gridColumns: GridCol[];
  inputs: Array<{ control: string; kind: string; boundField?: string }>;
  buttons: Array<{ control: string; caption: string }>;
  bindingMembers: string[]; // BindingSource.DataMember — thường là tên bảng/dataset table
}

const INPUT_KINDS: Array<[RegExp, string]> = [
  [/TextBox|TextEdit|MemoEdit/, "text"],
  [/ComboBox|LookUpEdit|ComboBoxEdit/, "select"],
  [/DateTimePicker|DateEdit/, "date"],
  [/NumericUpDown|SpinEdit/, "number"],
  [/CheckBox|CheckEdit/, "boolean"],
];

function parseDesigner(text: string): FormUi {
  const ui: FormUi = { gridColumns: [], inputs: [], buttons: [], bindingMembers: [] };

  // Grid column: gom theo tên object — WinForms (DataPropertyName/HeaderText)
  // + DevExpress (FieldName/Caption).
  const colProps = new Map<string, { field?: string; header?: string }>();
  for (const m of text.matchAll(
    /this\.(\w+)\.(?:DataPropertyName|FieldName)\s*=\s*"([^"]*)"/g,
  )) {
    const c = colProps.get(m[1]!) ?? {};
    c.field = m[2];
    colProps.set(m[1]!, c);
  }
  for (const m of text.matchAll(/this\.(\w+)\.(?:HeaderText|Caption)\s*=\s*"([^"]*)"/g)) {
    const c = colProps.get(m[1]!) ?? {};
    c.header = m[2];
    colProps.set(m[1]!, c);
  }
  for (const c of colProps.values()) {
    if (c.field) ui.gridColumns.push({ field: c.field.toLowerCase(), header: c.header ?? "" });
  }

  // Input controls: this.<name> = new <Type>() — phân loại theo INPUT_KINDS.
  for (const m of text.matchAll(/this\.(\w+)\s*=\s*new\s+([\w.]+)\(\)/g)) {
    const [, name, type] = m;
    for (const [re, kind] of INPUT_KINDS) {
      if (re.test(type!)) {
        ui.inputs.push({ control: name!, kind });
        break;
      }
    }
    if (/\.Button$|SimpleButton/.test(type!)) {
      ui.buttons.push({ control: name!, caption: "" });
    }
  }
  // Caption nút: this.btnX.Text = "..."
  const btnByName = new Map(ui.buttons.map((b) => [b.control, b]));
  for (const m of text.matchAll(/this\.(\w+)\.Text\s*=\s*"([^"]*)"/g)) {
    const b = btnByName.get(m[1]!);
    if (b) b.caption = m[2]!;
  }
  // DataBindings: Binding("Text", <src>, "col") → field bind của input.
  const inputByName = new Map(ui.inputs.map((i) => [i.control, i]));
  for (const m of text.matchAll(
    /this\.(\w+)\.DataBindings\.Add\(new System\.Windows\.Forms\.Binding\("[^"]*",\s*[^,]+,\s*"([^"]+)"/g,
  )) {
    const i = inputByName.get(m[1]!);
    if (i) i.boundField = m[2]!.toLowerCase();
  }
  // BindingSource.DataMember = "TABLE"
  for (const m of text.matchAll(/\.DataMember\s*=\s*"([^"]+)"/g)) {
    ui.bindingMembers.push(m[1]!.toLowerCase());
  }
  return ui;
}

/* ── Main ── */
const inv = YAML.parse(
  readFileSync(join(ERP_ROOT, "migration-plan/ui-inventory.yaml"), "utf8"),
) as { modules: Record<string, { allForms: string[] }> };
const formNames: string[] = inv.modules[moduleName]?.allForms ?? [];
if (formNames.length === 0) {
  console.error(`Module '${moduleName}' không có trong ui-inventory.yaml`);
  process.exit(1);
}

const raw = JSON.parse(
  readFileSync(join(ERP_ROOT, "migration-plan/ui-inventory-raw.json"), "utf8"),
) as Array<{ form: string; title: string; project: string; path: string }>;
const metaByForm = new Map(raw.filter((f) => f.project === "DQHF").map((f) => [f.form, f]));

console.log(`Phân tích ${formNames.length} form module '${moduleName}'...`);
const idx = buildCSharpIndex(DQHF_ROOT);

const out: Array<Record<string, unknown>> = [];
let mapped = 0;
for (const name of formNames) {
  const meta = metaByForm.get(name);
  const r = resolveFormProcs(idx, name);
  // Bảng ứng viên: repo class + đoán từ proc + DataMember.
  const tables = new Set<string>();
  for (const repo of r.repos) {
    const t = repoToTable(repo);
    if (t) tables.add(t);
  }
  for (const t of procToTables(r.procs)) tables.add(t);

  let ui: FormUi = { gridColumns: [], inputs: [], buttons: [], bindingMembers: [] };
  if (meta) {
    const designerPath = join(DQHF_ROOT, meta.path, `${name}.Designer.cs`);
    if (existsSync(designerPath)) {
      ui = parseDesigner(readFileSync(designerPath, "utf8"));
      for (const bm of ui.bindingMembers) if (erpTables.has(bm)) tables.add(bm);
    }
  }

  // Fallback: fingerprint cột grid khi resolver mù (data access kiểu khác).
  let fingerprint: { table: string; score: number } | null = null;
  if (tables.size === 0) {
    fingerprint = gridFingerprintTable(ui.gridColumns);
    if (fingerprint) tables.add(fingerprint.table);
  }

  // Bảng repo trỏ tới nhưng CHƯA import vào ERP → cần import bổ sung.
  const missing = r.repos
    .map((repo) =>
      repo
        .toLowerCase()
        .replace(/_(bol|dal|repository|repo)$/i, "")
        .replace(/^.*\./, ""),
    )
    .filter((t) => /^(tr|mes|kt|dqt|hr)_/.test(t) && !erpTables.has(t));

  // Bảng QUYỀN/NGỮ CẢNH (user, phân quyền, bộ phận, người duyệt, công ty) —
  // form nào cũng đụng nhưng KHÔNG phải data nghiệp vụ của màn hình.
  // ERP thay bằng RBAC + resource ACL — không tính khi chọn entity đích.
  const CONTEXT_TABLES = new Set([
    "sys_user",
    "sys_user_rule",
    "tr_bophan",
    "tr_nguoiduyet",
    "hr_congty",
  ]);
  const allEntities = [...tables].map((t) => erpTables.get(t)).filter(Boolean) as string[];
  const entityList = allEntities.filter((t) => !CONTEXT_TABLES.has(t));
  const contextEntities = allEntities.filter((t) => CONTEXT_TABLES.has(t));
  if (entityList.length > 0) mapped++;
  out.push({
    form: name,
    title: meta?.title ?? "",
    // Quy tắc đã chốt (2026-06-11): form không liên quan 130 bảng đã migrate
    // → LOẠI khỏi phạm vi chuyển đổi. Form CHỈ đụng bảng quyền/ngữ cảnh cũng
    // loại (chức năng = phân quyền → RBAC của ERP thay thế).
    inScope: entityList.length > 0,
    entities: entityList,
    ...(contextEntities.length ? { contextEntities } : {}),
    ...(fingerprint ? { fingerprintScore: Math.round(fingerprint.score * 100) / 100 } : {}),
    ...(missing.length ? { tablesMissing: [...new Set(missing)] } : {}),
    repos: r.repos,
    procs: r.procs,
    grid: { columns: ui.gridColumns.slice(0, 60) },
    inputs: ui.inputs.slice(0, 60),
    buttons: ui.buttons.filter((b) => b.caption).slice(0, 30),
    note: r.note,
  });
}

const allMissing = new Set<string>();
for (const f of out) for (const t of (f.tablesMissing as string[]) ?? []) allMissing.add(t);

// ── Cluster: form cùng BỘ data-entity = cùng màn hình, khác quyền/phiên bản
// → scaffold 1 page/cluster, biến thể xử lý bằng RBAC/saved-view.
const clusters = new Map<string, string[]>();
for (const f of out) {
  if (!f.inScope) continue;
  const key = ([...(f.entities as string[])].sort() as string[]).join(",");
  if (!clusters.has(key)) clusters.set(key, []);
  clusters.get(key)?.push(f.form as string);
}
const clusterList = [...clusters.entries()]
  .map(([entities, forms]) => ({ entities: entities.split(","), forms }))
  .sort((a, b) => b.forms.length - a.forms.length);

const outDir = join(ERP_ROOT, "migration-plan/ui");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${moduleName}.forms.yaml`);
writeFileSync(
  outPath,
  YAML.stringify(
    {
      module: moduleName,
      generatedAt: "2026-06-11",
      tablesMissingInErp: [...allMissing].sort(),
      pageClusters: clusterList,
      forms: out,
    },
    { lineWidth: 0 },
  ),
  "utf8",
);
console.log(`Map được entity: ${mapped}/${formNames.length}`);
console.log(`Page cluster (1 page/cluster): ${clusterList.length}`);
for (const c of clusterList.filter((x) => x.forms.length > 1)) {
  console.log(`  ${c.forms.length} form → [${c.entities.join(",")}]: ${c.forms.join(", ")}`);
}
if (allMissing.size > 0) console.log(`Bảng cần import bổ sung: ${[...allMissing].join(", ")}`);
console.log(`Saved ${outPath}`);
