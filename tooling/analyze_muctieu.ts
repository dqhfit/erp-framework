import { MssqlClient } from "../packages/mssql-client/src/index.ts";
const cs = process.env.MSSQL_CONNECTION_STRING!;
const client = new MssqlClient({ connectionString: cs });
await client.connect();
const pool = (client as any)["pool"];

// Tháng gần nhất
const rMax = await pool
  .request()
  .query(`SELECT MAX(nam*100+thang) AS m FROM tr_muctieu_sanxuat2 WHERE mucthuong=1`);
const maxYM: number = rMax.recordset[0].m;
const globalNam = Math.floor(maxYM / 100);
const globalThang = maxYM % 100;

// Chi tiết hàng ngày tháng gần nhất (chỉ công đoạn có dữ liệu)
const r5 = await pool
  .request()
  .input("nam", globalNam)
  .input("thang", globalThang)
  .query(`
    SELECT
      c.macongdoan AS bp,
      DAY(c.ngaythang) AS ngay,
      LEFT(DATENAME(WEEKDAY, c.ngaythang), 3) AS thu,
      c.muctieu_tonggio_hc AS gio_mt,
      c.tonggio AS gio_tt,
      c.sokhoi_hoanthanh AS khoi_ht,
      c.tile_hoanthanh AS tile_ht,
      c.songuoi_hiendien_hc AS nhc,
      c.songuoi_hiendien_tc AS ntc,
      c.giochenhlech AS gio_cl
    FROM tr_muctieu_sanxuat2_chitiet c
    WHERE YEAR(c.ngaythang) = @nam
      AND MONTH(c.ngaythang) = @thang
      AND c.macongdoan IN (SELECT mabophan FROM tr_muctieu_sanxuat2 WHERE mucthuong=1 AND nam=@nam AND thang=@thang AND col13 > 0)
    ORDER BY c.macongdoan, c.ngaythang
  `);

// Tóm tắt từng công đoạn từ chi tiết
interface Row {
  bp: string;
  ngay: number;
  thu: string;
  gio_mt: number;
  gio_tt: number;
  khoi_ht: number;
  tile_ht: number;
  nhc: number;
  ntc: number;
  gio_cl: number;
}
const rows: Row[] = r5.recordset;

const byBp: Record<string, Row[]> = {};
for (const row of rows) {
  if (!byBp[row.bp]) byBp[row.bp] = [];
  byBp[row.bp].push(row);
}

console.log(`\n=== CHI TIẾT THÁNG ${globalThang}/${globalNam} (CÁC BỘ PHẬN CÓ DỮ LIỆU) ===\n`);
const summary: any[] = [];
for (const [bp, bpRows] of Object.entries(byBp)) {
  const workDays = bpRows.filter((r) => r.thu !== "Sun");
  const activeDays = bpRows.filter((r) => r.nhc > 0 || r.ntc > 0);
  const absentDays = workDays.filter((r) => r.nhc === 0 && r.ntc === 0);
  const totalGioMt = bpRows.reduce((s, r) => s + (r.gio_mt || 0), 0);
  const totalGioTt = bpRows.reduce((s, r) => s + (r.gio_tt || 0), 0);
  const totalKhoiHt = bpRows.reduce((s, r) => s + (r.khoi_ht || 0), 0);
  const gioHieuSuat = totalGioMt > 0 ? (totalGioTt / totalGioMt) * 100 : 0;
  // Ngày yếu: có người làm nhưng tile_ht < 80% so với tile_ht TB
  const activeTile = activeDays.filter((r) => r.tile_ht > 0).map((r) => r.tile_ht);
  const tileTb =
    activeTile.length > 0 ? activeTile.reduce((a, b) => a + b, 0) / activeTile.length : 0;
  const badDays = activeDays.filter((r) => r.tile_ht > 0 && r.tile_ht < tileTb * 0.8);
  const topDays = activeDays
    .filter((r) => r.tile_ht > 0)
    .sort((a, b) => b.tile_ht - a.tile_ht)
    .slice(0, 3);

  summary.push({
    bp,
    ngayLamViec: workDays.length,
    ngayCoNguoi: activeDays.length,
    ngayVang: absentDays.length,
    gioMT: totalGioMt.toFixed(0),
    gioTT: totalGioTt.toFixed(0),
    "hsuGio%": gioHieuSuat.toFixed(0),
    khoiHT: totalKhoiHt.toFixed(1),
    tileHT_tb: tileTb.toFixed(3),
    ngayYeu: badDays.length,
    ngayTot_top3: topDays.map((r) => `${r.ngay}(${r.tile_ht.toFixed(2)})`).join("/"),
  });
}

console.table(summary);

// Heatmap ngày yếu: danh sách ngày tile_ht thấp bất thường
console.log("\n=== NGÀY YẾU (<80% tile TB) THEO TỪNG BỘ PHẬN ===");
for (const [bp, bpRows] of Object.entries(byBp)) {
  const activeDays = bpRows.filter((r) => (r.nhc > 0 || r.ntc > 0) && r.tile_ht > 0);
  if (activeDays.length === 0) continue;
  const tileTb = activeDays.reduce((s, r) => s + r.tile_ht, 0) / activeDays.length;
  const bad = activeDays.filter((r) => r.tile_ht < tileTb * 0.8);
  if (bad.length > 0) {
    console.log(
      `${bp.padEnd(6)}: ${bad.map((r) => `${r.ngay}/${globalThang}(${r.thu},TL=${r.tile_ht.toFixed(2)},NH=${r.nhc}+${r.ntc}TC)`).join(" | ")}`,
    );
  }
}

await client.close();
