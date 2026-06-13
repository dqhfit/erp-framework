/* Dump cột (tên + kiểu) của các bảng MSSQL — so khớp khi nghi rename.
   Dùng: ... dump-columns.ts TABLE1 TABLE2 ... */
import { MssqlClient } from "@erp-framework/mssql-client";

const want = process.argv.slice(2);
const c = MssqlClient.fromEnv();
await c.connect();
try {
  for (const name of want) {
    const info = await c.getTable("dbo", name);
    if (!info) {
      console.log(`\n${name}: KHÔNG tồn tại`);
      continue;
    }
    console.log(
      `\n${name} (PK=[${info.primaryKey.join(",") || "-"}], ${info.columns.length} cột):`,
    );
    console.log(info.columns.map((col) => `${col.name}:${col.dataType}`).join(", "));
  }
} finally {
  await c.close();
}
