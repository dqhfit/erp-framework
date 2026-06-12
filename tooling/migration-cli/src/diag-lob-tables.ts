/* diag-lob-tables.ts — quét các bảng trong import-items.json tìm cột
   varbinary/image (nghi phạm OOM worker khi nhét Buffer vào jsonb).
   Chạy: node --env-file=packages/server/.env --import tsx \
     tooling/migration-cli/src/diag-lob-tables.ts */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MssqlClient } from "@erp-framework/mssql-client";

const items = (
  JSON.parse(
    readFileSync(resolve(process.cwd(), "migration-plan/ui/import-items.json"), "utf8"),
  ) as {
    items: Array<{ entityName: string }>;
  }
).items;

const c = MssqlClient.fromEnv();
await c.connect();
try {
  const names = items.map((i) => `'${i.entityName}'`).join(",");
  const rows = await c.query<{ tbl: string; col: string; dt: string; mx: number | null }>(`
    SELECT t.name AS tbl, c.name AS col, ty.name AS dt, NULL AS mx
    FROM sys.tables t
      JOIN sys.columns c ON c.object_id = t.object_id
      JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    WHERE t.name IN (${names}) AND ty.name IN ('varbinary','image')
    ORDER BY t.name
  `);
  if (rows.length === 0) {
    console.log("Không bảng nào còn cột varbinary/image.");
  }
  for (const r of rows) {
    const sz = await c.query<{ mx: number | null; tot: number | null }>(
      `SELECT MAX(DATALENGTH([${r.col}])) AS mx, SUM(CAST(DATALENGTH([${r.col}]) AS BIGINT)) AS tot FROM dbo.[${r.tbl}]`,
    );
    console.log(`${r.tbl}.${r.col} (${r.dt}): max=${sz[0]?.mx ?? 0}B total=${sz[0]?.tot ?? 0}B`);
  }
} finally {
  await c.close();
}
