/* diag-table.ts — chẩn đoán nhanh 1 bảng MSSQL: row count + PK + kiểu PK.
   Dùng khi job import kẹt ở 1 bảng (vd treo stream/keyset).
   Chạy: node --env-file=packages/server/.env --import tsx \
     tooling/migration-cli/src/diag-table.ts <tên bảng> */
import { MssqlClient } from "@erp-framework/mssql-client";

const name = process.argv[2];
if (!name) {
  console.error("Thiếu tên bảng");
  process.exit(1);
}

const c = MssqlClient.fromEnv();
await c.connect();
try {
  const rows = await c.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM dbo.[${name.replace(/[[\]]/g, "")}]`,
  );
  console.log("count:", rows[0]?.n);
  const info = await c.getTable("dbo", name);
  if (info) {
    console.log("pk:", info.primaryKey.join(",") || "(KHÔNG)", "| cols:", info.columns.length);
    const pkcol = info.columns.find((x) => x.name === info.primaryKey[0]);
    console.log("pk type:", pkcol?.dataType);
    console.log("cols:", info.columns.map((x) => `${x.name}:${x.dataType}`).join(" "));
    // Cột binary/lob lớn — nghi phạm làm worker nghẹt khi nhét vào ext jsonb.
    const lobs = info.columns.filter((x) => /varbinary|image|ntext|^text$/i.test(x.dataType));
    for (const l of lobs) {
      const r = await c.query<{ mx: number | null; tot: number | null }>(
        `SELECT MAX(DATALENGTH([${l.name}])) AS mx, SUM(CAST(DATALENGTH([${l.name}]) AS BIGINT)) AS tot FROM dbo.[${name.replace(/[[\]]/g, "")}]`,
      );
      console.log(`lob ${l.name}: max=${r[0]?.mx ?? 0}B total=${r[0]?.tot ?? 0}B`);
    }
  } else {
    console.log("getTable null");
  }
} finally {
  await c.close();
}
