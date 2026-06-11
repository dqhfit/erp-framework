/* ==========================================================
   dump-procs.ts — Dump body T-SQL + params của stored proc MSSQL
   ra file .sql để phục vụ port tay (Tier D).

   Chạy:
     node --env-file=packages/server/.env --import tsx \
       tooling/migration-cli/src/dump-procs.ts TR_FOO TR_BAR ...

   Output: migration-plan/ui/proc-bodies/<name_lower>.sql
   Read-only — chỉ SELECT sys.sql_modules, không cần MSSQL_ALLOW_WRITE.
   ========================================================== */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { MssqlClient } from "@erp-framework/mssql-client";

const names = process.argv.slice(2).filter(Boolean);
if (names.length === 0) {
  console.error("Cách dùng: dump-procs.ts <PROC1> <PROC2> ...");
  process.exit(1);
}

const outDir = resolve(process.cwd(), "migration-plan", "ui", "proc-bodies");
mkdirSync(outDir, { recursive: true });

const mssql = MssqlClient.fromEnv();
await mssql.connect();
try {
  for (const raw of names) {
    const parts = raw.split(".");
    const schema = parts.length > 1 ? (parts[0] ?? "dbo") : "dbo";
    const bare = (parts.length > 1 ? parts.slice(1).join(".") : parts[0]) ?? raw;
    const info = await mssql.getProc(schema, bare);
    if (!info) {
      console.error(`✗ Không đọc được ${schema}.${bare}`);
      continue;
    }
    const params =
      info.parameters.length > 0
        ? info.parameters
            .map(
              (p) =>
                `-- ${p.name} ${p.dataType}${p.isOutput ? " OUTPUT" : ""}${p.hasDefault ? " (default)" : ""}`,
            )
            .join("\n")
        : "-- (khong co tham so)";
    const file = resolve(outDir, `${bare.toLowerCase()}.sql`);
    writeFileSync(file, `-- PARAMS:\n${params}\n\n${info.body}\n`, "utf8");
    console.log(`✓ ${schema}.${bare} → ${file}`);
  }
} finally {
  await mssql.close();
}
