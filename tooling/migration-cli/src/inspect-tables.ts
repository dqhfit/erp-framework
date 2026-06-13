import { MssqlClient } from "@erp-framework/mssql-client";

const want = process.argv.slice(2);
const c = MssqlClient.fromEnv();
await c.connect();
try {
  for (const name of want) {
    const info = await c.getTable("dbo", name);
    if (!info) {
      console.log(`${name}: KHÔNG tồn tại MSSQL`);
      continue;
    }
    const cnt = await c.query<{ n: number }>(`SELECT COUNT(*) AS n FROM dbo.[${name}]`);
    const lob = info.columns.filter((col) =>
      /^(varbinary|image|timestamp|rowversion|text|ntext)$/i.test(col.dataType),
    );
    console.log(
      `${name}: rows=${cnt[0]?.n ?? "?"} | PK=[${info.primaryKey.join(",") || "KHÔNG"}] | cols=${info.columns.length} | LOB/binary=[${lob.map((l) => `${l.name}:${l.dataType}`).join(", ") || "-"}]`,
    );
  }
} finally {
  await c.close();
}
