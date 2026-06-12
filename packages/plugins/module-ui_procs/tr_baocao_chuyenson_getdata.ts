/* Port TR_BAOCAO_CHUYENSON_GETDATA — báo cáo chuyền sơn theo ngày: gom số
   lượng theo (công đoạn, đơn hàng, sản phẩm, chi tiết, dày/rộng/dài) cho
   nhóm công đoạn sơn/chà/dặm/UV cố định.
   Nguồn: migration-plan/ui/proc-bodies/tr_baocao_chuyenson_getdata.sql

   2 bảng (tr_trangthai_sanxuat INNER JOIN trtb_m_location theo congdoan =
   c_location) → tách 2 query + ghép JS (batch-stitch):
     1. Aggregate 1 bảng tr_trangthai_sanxuat (SQL thô qua procTable)
     2. trtb_m_location → map c_location → n_location (tencongdoan);
        INNER JOIN gốc → dòng không tìm thấy location bị LOẠI. Nếu 1
        c_location có nhiều dòng location, lấy dòng đầu (GROUP BY gốc có
        n_location nên trùng tên tự gộp). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable, rows } from "../src/proc-table";

// Danh sách công đoạn cố định trong proc gốc
const CONGDOAN_SON = [
  "SON01-PROD",
  "SCT01-PROD",
  "SCT1-PROD",
  "DG01-PROD",
  "DG02-PROD",
  "UV03-PROD",
];

interface ChuyensonRow {
  congdoan: string | null;
  tencongdoan: string | null;
  donhang: string | null;
  masp: string | null;
  mact: string | null;
  tenct: string | null;
  dayy: number | null;
  rong: number | null;
  dai: number | null;
  soluong: number;
}

export async function trBaocaoChuyensonGetdata(
  db: DB,
  companyId: string,
  args: {
    ngaythang: string;
  },
): Promise<ChuyensonRow[]> {
  if (!args.ngaythang) throw new Error("Thiếu ngaythang");

  const t = await procTable(db, companyId, "tr_trangthai_sanxuat");

  // Bước 1: aggregate trên tr_trangthai_sanxuat — alias theo proc gốc
  // (madonhang → donhang, masp1 → masp). So sánh ngày theo ::date (cột
  // text ISO, tham số date-only) — cùng pattern tr_phieuyeucau_confirm.
  const res = await db.execute(sql`
    SELECT
      ${t.text("congdoan")} AS congdoan,
      ${t.text("madonhang")} AS donhang,
      ${t.text("masp1")} AS masp,
      ${t.text("mact")} AS mact,
      ${t.text("tenct")} AS tenct,
      ${t.num("dayy")} AS dayy,
      ${t.num("rong")} AS rong,
      ${t.num("dai")} AS dai,
      SUM(${t.num("soluong")}) AS soluong
    FROM ${t.tbl}
    WHERE ${t.scope}
      AND (${t.ts("ngaythang")})::date = ${args.ngaythang}::date
      AND ${t.text("congdoan")} IN (${sql.join(
        CONGDOAN_SON.map((v) => sql`${v}`),
        sql`, `,
      )})
    GROUP BY ${t.text("congdoan")}, ${t.text("madonhang")}, ${t.text("masp1")},
      ${t.text("mact")}, ${t.text("tenct")}, ${t.num("dayy")}, ${t.num("rong")}, ${t.num("dai")}
  `);
  const agg = rows<{
    congdoan: string | null;
    donhang: string | null;
    masp: string | null;
    mact: string | null;
    tenct: string | null;
    dayy: unknown;
    rong: unknown;
    dai: unknown;
    soluong: unknown;
  }>(res);
  if (agg.length === 0) return [];

  // Bước 2: trtb_m_location — tên công đoạn theo c_location
  const congdoans = [...new Set(agg.map((r) => r.congdoan).filter((v): v is string => v != null))];
  const loc = await procTable(db, companyId, "trtb_m_location");
  const locs = await loc.listWhere(sql`
    ${loc.text("c_location")} IN (${sql.join(
      congdoans.map((v) => sql`${v}`),
      sql`, `,
    )})
  `);
  const tenByCode = new Map<string, string | null>();
  for (const l of locs) {
    const key = l.c_location == null ? null : String(l.c_location);
    if (key != null && !tenByCode.has(key)) {
      tenByCode.set(key, l.n_location == null ? null : String(l.n_location));
    }
  }

  const toNum = (v: unknown): number | null => (v == null ? null : Number(v));

  // Ghép: INNER JOIN → loại dòng không có location khớp
  const out: ChuyensonRow[] = [];
  for (const r of agg) {
    if (r.congdoan == null || !tenByCode.has(r.congdoan)) continue;
    out.push({
      congdoan: r.congdoan,
      tencongdoan: tenByCode.get(r.congdoan) ?? null,
      donhang: r.donhang,
      masp: r.masp,
      mact: r.mact,
      tenct: r.tenct,
      dayy: toNum(r.dayy),
      rong: toNum(r.rong),
      dai: toNum(r.dai),
      soluong: Number(r.soluong ?? 0),
    });
  }

  // Proc gốc không ORDER BY — sort nhẹ cho output ổn định
  return out.sort(
    (a, z) =>
      (a.congdoan ?? "").localeCompare(z.congdoan ?? "") ||
      (a.donhang ?? "").localeCompare(z.donhang ?? "") ||
      (a.masp ?? "").localeCompare(z.masp ?? ""),
  );
}
