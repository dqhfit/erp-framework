/* Resolve form danh_muc → procs qua repo layer (dùng lại legacy-menu-resolve).
   Chạy: npx tsx tooling/ui-migration/resolve-danhmuc.mts (cwd = repo root) */
import { readFileSync, writeFileSync } from "node:fs";
import {
  buildCSharpIndex,
  resolveFormProcs,
} from "../../packages/server/src/legacy-menu-resolve";

const ROOT = "D:/code/DotNET/DQHF";
const analysis = JSON.parse(
  readFileSync("D:/code/cowok/Apps/erp-framework/migration-plan/ui-danh-muc-analysis.json", "utf8"),
) as Array<{ form: string; title: string; tablesInErp: string[]; procs: string[] }>;

const idx = buildCSharpIndex(ROOT);
const out: Array<Record<string, unknown>> = [];
for (const f of analysis) {
  try {
    const r = resolveFormProcs(idx, f.form);
    out.push({
      form: f.form,
      title: f.title,
      procs: [...new Set([...(f.procs ?? []), ...((r as { procs?: string[] })?.procs ?? [])])].sort(),
      tablesDirect: f.tablesInErp,
    });
  } catch (e) {
    out.push({ form: f.form, title: f.title, error: (e as Error).message });
  }
}
writeFileSync("D:/code/cowok/Apps/erp-framework/migration-plan/ui-danh-muc-resolved.json", JSON.stringify(out, null, 1), "utf8");
const withProcs = out.filter((o) => Array.isArray(o.procs) && (o.procs as string[]).length > 0);
console.log(`Resolved: ${out.length} form, có proc: ${withProcs.length}`);
