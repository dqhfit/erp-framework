import { MssqlClient } from "@erp-framework/mssql-client";
const c = MssqlClient.fromEnv();
await c.connect();
const r = await c.query<{ name: string }>(
  `SELECT name FROM sys.objects WHERE type='P' AND name IN ('TR_QUYTRINH_SON_DELETEALL','TR_MUCTIEU_SANXUAT2_TINHTOAN','TR_TINHGIA_BY_DDH2')`,
);
console.log("Proc còn tồn tại MSSQL:", JSON.stringify(r.map((x) => x.name)));
await c.close();
