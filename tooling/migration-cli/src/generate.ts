/* ==========================================================
   generate.ts — Sinh skeleton từ manifest:
     - packages/server/src/seed-modules/<module>.ts
       (seed entity + field + page mẫu)
     - packages/plugins/module-<module>/<proc>.ts cho mỗi tier D
     - procedures-skeleton cho mỗi tier B (file YAML upload qua tRPC)
     - workflow trigger=scheduled cho mỗi tier C
   ========================================================== */

import { readManifest } from "./manifest.js";

export interface GenerateOptions {
  module: string;
  dryRun: boolean;
}

export async function runGenerate(opts: GenerateOptions): Promise<void> {
  const m = readManifest(opts.module);
  console.log(`▸ Generate skeleton cho module "${opts.module}"`);
  console.log(`  Bảng: ${m.tables.length}  Proc: ${m.procs.length}`);
  if (opts.dryRun) console.log(`  (DRY-RUN — không ghi file)`);

  const tierB = m.procs.filter((p) => p.suggestedTier === "B");
  const tierC = m.procs.filter((p) => p.suggestedTier === "C");
  const tierD = m.procs.filter((p) => p.suggestedTier === "D");

  console.log(`\nDự kiến sinh:`);
  console.log(`  - packages/server/src/seed-modules/${m.module}.ts  (entity + page)`);
  for (const p of tierB) {
    console.log(`  - procedure JS skeleton: ${p.targetProcName ?? procShortName(p.name)}`);
  }
  for (const p of tierD) {
    console.log(`  - packages/plugins/module-${m.module}/${procShortName(p.name)}.ts`);
  }
  for (const p of tierC) {
    console.log(
      `  - workflow scheduled: ${procShortName(p.name)}${p.schedule ? ` (${p.schedule})` : ""}`,
    );
  }

  console.log(
    `\n▸ TODO: implement file emission. ` +
      `Hiện tại chỉ liệt kê; sau khi module đầu tiên được duyệt manifest, ` +
      `viết emitter cho:` +
      `\n    - seed-modules/<module>.ts: dùng pattern packages/server/src/seed.ts` +
      `\n    - plugins/module-<module>/<proc>.ts: WorkflowNodePlugin hoặc function` +
      `\n      export với signature (db: DB, companyId: string, args: any).`,
  );
}

function procShortName(full: string): string {
  return full.split(".").pop() ?? full;
}
