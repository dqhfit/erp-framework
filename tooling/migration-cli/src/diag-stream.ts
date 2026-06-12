/* diag-stream.ts — tái hiện đúng query keyset của streamReadByPk cho 1 bảng
   để xác định treo ở MSSQL (lock) hay ở worker PG-side.
   Chạy: node --env-file=packages/server/.env --import tsx \
     tooling/migration-cli/src/diag-stream.ts <bảng> <pk> */
import { MssqlClient } from "@erp-framework/mssql-client";

const table = process.argv[2];
const pk = process.argv[3] ?? "id";
if (!table) {
  console.error("Thiếu tên bảng");
  process.exit(1);
}

const c = MssqlClient.fromEnv();
await c.connect();
try {
  const t0 = Date.now();
  const r = await c.streamReadByPk({ schemaTable: `dbo.${table}`, pkColumn: pk, batchSize: 5000 });
  console.log(
    `rows=${r.rows.length} isEnd=${r.isEnd} nextPk=${r.nextLastPk} in ${Date.now() - t0}ms`,
  );
} finally {
  await c.close();
}
