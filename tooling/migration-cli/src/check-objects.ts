/* Kiểm object (proc P / table U / view V) còn tồn tại MSSQL không.
   Dùng: ... check-objects.ts NAME1 NAME2 ... (so khớp chính xác name). */
import { MssqlClient } from "@erp-framework/mssql-client";

const want = process.argv.slice(2);
const c = MssqlClient.fromEnv();
await c.connect();
try {
  const inList = want.map((n) => `'${n.replace(/'/g, "''")}'`).join(",");
  const r = await c.query<{ name: string; type: string }>(
    `SELECT name, type_desc AS type FROM sys.objects WHERE name IN (${inList})`,
  );
  const found = new Map(r.map((x) => [x.name.toLowerCase(), x.type]));
  for (const n of want) {
    const t = found.get(n.toLowerCase());
    console.log(`${n}: ${t ? `CÓ (${t})` : "KHÔNG"}`);
  }
} finally {
  await c.close();
}
