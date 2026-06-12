/* dump-function.ts — dump định nghĩa scalar function MSSQL (OBJECT_DEFINITION).
   Chạy: node --env-file=packages/server/.env --import tsx \
     tooling/migration-cli/src/dump-function.ts <tên function> */
import { MssqlClient } from "@erp-framework/mssql-client";

const name = process.argv[2];
if (!name) {
  console.error("Thiếu tên function");
  process.exit(1);
}

const c = MssqlClient.fromEnv();
await c.connect();
try {
  const r = await c.query<{ d: string | null }>(
    `SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.${name.replace(/[^\w]/g, "")}')) AS d`,
  );
  console.log(r[0]?.d ?? "(không tồn tại)");
} finally {
  await c.close();
}
