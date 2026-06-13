import { MssqlClient } from "@erp-framework/mssql-client";

const pats = process.argv.slice(2);
const c = MssqlClient.fromEnv();
await c.connect();
try {
  const like = pats.map((p) => `name LIKE '%${p.replace(/'/g, "''")}%'`).join(" OR ");
  const r = await c.query<{ name: string; type_desc: string }>(
    `SELECT name, type_desc FROM sys.objects WHERE type IN ('U','V') AND (${like}) ORDER BY name`,
  );
  for (const row of r) console.log(`${row.name} (${row.type_desc})`);
  if (r.length === 0) console.log("Không tìm thấy bảng/view khớp.");
} finally {
  await c.close();
}
