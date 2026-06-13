/* Trích grid.columns (field + header, theo thứ tự DQHF) của các form trong
   1 module khớp entity cho trước. Dùng để bám layout DQHF khi enrich page.
   Chạy (cwd packages/server): npx tsx ../../tooling/ui-migration/show-form-grid.mts <module> <entity> */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(new URL("../../packages/server/package.json", import.meta.url));
const YAML = require("yaml") as typeof import("yaml");

const ERP_ROOT = "D:/code/cowok/Apps/erp-framework";
const moduleName = process.argv[2];
const entity = process.argv[3];
if (!moduleName || !entity) {
  console.error("Dùng: show-form-grid.mts <module> <entity>");
  process.exit(1);
}

const doc = YAML.parse(
  readFileSync(join(ERP_ROOT, "migration-plan/ui", `${moduleName}.forms.yaml`), "utf8"),
) as {
  forms: Array<{
    form: string;
    title: string;
    entities: string[];
    grid: { columns: Array<{ field: string; header: string }> };
  }>;
};

for (const f of doc.forms) {
  if (!f.entities?.includes(entity)) continue;
  const cols = f.grid?.columns ?? [];
  console.log(`\n=== ${f.form} — "${f.title}" (entities: ${f.entities.join(", ")}) ===`);
  console.log(`grid ${cols.length} cột (thứ tự DQHF):`);
  for (const c of cols) console.log(`  ${c.field}  ⟶  "${c.header}"`);
}
