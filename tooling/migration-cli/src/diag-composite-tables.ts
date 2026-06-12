/* diag-composite-tables.ts — đo row count + PK của các bảng PK ghép/không PK
   (nhóm bị full-import bỏ qua) để chọn đường import phù hợp.
   Chạy: node --env-file=packages/server/.env --import tsx \
     tooling/migration-cli/src/diag-composite-tables.ts */
import { MssqlClient } from "@erp-framework/mssql-client";

const TABLES = [
  "ps_kehoach_donhang",
  "sr_giamtrucongno_chitiet",
  "stockbalances",
  "tr_baogia_htr_govan",
  "tr_baogia_htr_ngukim",
  "tr_baogia_htr_tong",
  "tr_baogia_phoi_govan",
  "tr_baogia_phoi_tong",
  "tr_baogia3_chiphi",
  "tr_baogia3_donggoi",
  "tr_baogia3_govan",
  "tr_baogia3_ngukim",
  "tr_baogia3_son",
  "tr_baogia3_tonghop",
  "tr_bieumau_friday",
  "tr_bom_mix",
  "tr_congthuc_donggoi",
  "tr_danhsach_dexuat",
  "tr_dinhmuc_chiphi_sanpham",
  "tr_dinhmuc_son3_mauson",
  "trtb_m_location_process",
  "tr_chitiet_hangtrang",
];

const c = MssqlClient.fromEnv();
await c.connect();
try {
  for (const t of TABLES) {
    try {
      const n = await c.query<{ n: number }>(`SELECT COUNT(*) AS n FROM dbo.[${t}]`);
      const info = await c.getTable("dbo", t);
      console.log(
        `${t}: ${n[0]?.n ?? "?"} rows | pk: ${info?.primaryKey.join("+") || "(KHÔNG)"} | cols: ${info?.columns.length ?? "?"}`,
      );
    } catch (e) {
      console.log(`${t}: LỖI ${(e as Error).message}`);
    }
  }
} finally {
  await c.close();
}
