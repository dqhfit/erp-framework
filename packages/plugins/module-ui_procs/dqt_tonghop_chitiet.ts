/* Port DQT_TONGHOP_DONHANG_GET / GET2 / GET3 — Tổng hợp chi tiết theo đơn
   hàng (form frmINV137, R62). 3 chế độ gộp vào 1 proc qua arg `mode`:
     - mode 0 "theo chi tiết"  (GET) : gộp toàn bộ đơn theo quy cách chi tiết
       (không maddh); thêm rong_sc/dai_sc + tilehaohut/congdaiphoi (tr_nguyenlieu_gva).
     - mode 1 "theo sản phẩm"  (GET2): gộp theo maddh + mã hàng trắng (A.chitiet).
     - mode 2 "chi tiết đầy đủ"(GET3): KHÔNG gộp, mỗi dòng = 1 (đơn × định mức);
       thêm tensp (tr_sanpham) + ghichu định mức.

   Nguồn: proc-bodies/dqt_tonghop_donhang_get{,2,3}.sql. Join gốc:
   tr_dondathang_chitiet A ⋈ tr_dinhmuc_govan B (A.masp=B.masp, 1-N) +
   LEFT tr_baogia_chiphi_veneer (×3: matchinh/matphu/dan_canh → loaihang) +
   tr_sanpham (mode2) + tr_nguyenlieu_gva (mode0). proc-table không qualify
   bảng trong JOIN → batch-stitch JS (như tr_baocao_chuyenson_getdata).

   soluong = SUM(A.soluong × B.soluong_tc); m3_tc = SUM(dày×rộng×dài×SL/1e9).
   loaichitiet theo dai_tc: ≤999 Ngắn · 1000–1599 Trung · ≥1600 Dài. */
import type { DB } from "@erp-framework/server/db";
import { type SQL, sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

interface TongHopRow {
  maddh: string | null;
  tensp: string | null;
  mahtr: string | null;
  chitiet: string | null;
  nguyenlieu: string | null;
  chitiet_ghep2: string;
  dayy_tc: number | null;
  rong_tc: number | null;
  dai_tc: number | null;
  dayy_sc: number | null;
  rong_sc: number | null;
  dai_sc: number | null;
  soluong_tc: number | null;
  soluong: number;
  m3_tc: number;
  ghichu: string | null;
  veneer_canhngan: string | null;
  veneer_canhdai: string | null;
  veneer_matchinh: string | null;
  veneer_matphu: string | null;
  veneer_dan_canh: string | null;
  mc: string | null;
  mp: string | null;
  dc: string | null;
  tilehaohut: number | null;
  congdaiphoi: number | null;
  loaichitiet: string | null;
}

const s = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const num0 = (v: unknown): number => num(v) ?? 0;
function inText(expr: SQL, vals: string[]) {
  return sql`${expr} IN (${sql.join(
    vals.map((v) => sql`${v}`),
    sql`, `,
  )})`;
}
function loaiChitiet(dai: number | null): string | null {
  if (dai == null) return null;
  if (dai > 0 && dai <= 999) return "Ngắn";
  if (dai >= 1000 && dai <= 1599) return "Trung";
  if (dai >= 1600) return "Dài";
  return null;
}

export async function dqtTonghopChitiet(
  db: DB,
  companyId: string,
  args: { maddh?: string; mode?: number | string },
): Promise<TongHopRow[]> {
  const maddhList = String(args.maddh ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (maddhList.length === 0) throw new Error("Thiếu đơn đặt hàng (maddh)");
  const mode = Number(args.mode ?? 0);

  // ===== A: tr_dondathang_chitiet (lọc đơn + active + chi tiết hàng trắng) =====
  const A = await procTable(db, companyId, "tr_dondathang_chitiet");
  const aRows = await A.listWhere(sql`
    ${inText(A.text("maddh"), maddhList)}
    AND ${A.bool("active")} = true
    AND ${A.text("chitiet")} LIKE 'W%'
  `);
  if (aRows.length === 0) return [];

  // ===== B: tr_dinhmuc_govan theo masp (1-N) =====
  const masps = [...new Set(aRows.map((r) => s(r.masp)).filter((v): v is string => !!v))];
  if (masps.length === 0) return [];
  const B = await procTable(db, companyId, "tr_dinhmuc_govan");
  // mode 0/1 lọc nguyên liệu khác rỗng/'0'; mode 2 không lọc (GET3).
  const nlFilter =
    mode === 2 ? sql`TRUE` : sql`COALESCE(${B.text("nguyenlieu")}, '') NOT IN ('', '0')`;
  const bRows = await B.listWhere(sql`
    ${inText(B.text("masp"), masps)}
    AND ${B.text("mact")} <> '000'
    AND ${B.num("dayy_tc")} > 0
    AND ${nlFilter}
  `);
  if (bRows.length === 0) return [];
  const bByMasp = new Map<string, Record<string, unknown>[]>();
  for (const b of bRows) {
    const k = s(b.masp);
    if (k == null) continue;
    const arr = bByMasp.get(k);
    if (arr) arr.push(b);
    else bByMasp.set(k, [b]);
  }

  // ===== Lookup veneer (loaihang) + nguyên liệu GVA (mode 0) + sản phẩm (mode 2) =====
  const veneerIds = new Set<string>();
  for (const b of bRows) {
    for (const f of ["veneer_matchinh", "veneer_matphu", "veneer_dan_canh"]) {
      const v = s(b[f]);
      if (v) veneerIds.add(v);
    }
  }
  const loaihangById = new Map<string, string | null>();
  if (veneerIds.size > 0) {
    const V = await procTable(db, companyId, "tr_baogia_chiphi_veneer");
    const vRows = await V.listWhere(inText(V.text("id"), [...veneerIds]));
    for (const v of vRows) {
      const k = s(v.id);
      if (k != null && !loaihangById.has(k)) loaihangById.set(k, s(v.loaihang));
    }
  }

  const nlById = new Map<string, { tilehaohut: number | null; congdaiphoi: number | null }>();
  if (mode === 0) {
    const nlIds = new Set<string>();
    for (const b of bRows) {
      const v = s(b.id_nguyenlieu);
      if (v) nlIds.add(v);
    }
    if (nlIds.size > 0) {
      const NL = await procTable(db, companyId, "tr_nguyenlieu_gva");
      const nlRows = await NL.listWhere(inText(NL.text("id"), [...nlIds]));
      for (const n of nlRows) {
        const k = s(n.id);
        if (k != null && !nlById.has(k))
          nlById.set(k, { tilehaohut: num(n.tilehaohut), congdaiphoi: num(n.congdaiphoi) });
      }
    }
  }

  const tenspByMasp = new Map<string, string | null>();
  if (mode === 2) {
    const SP = await procTable(db, companyId, "tr_sanpham");
    const spRows = await SP.listWhere(inText(SP.text("masp"), masps));
    for (const p of spRows) {
      const k = s(p.masp);
      if (k == null || tenspByMasp.has(k)) continue;
      const vn = s(p.tensp_vn);
      tenspByMasp.set(k, vn && vn.length > 0 ? vn : s(p.tensp));
    }
  }

  // ===== Expand A × B(masp) + tính soluong/m3 =====
  interface Expanded extends TongHopRow {
    _key: string;
  }
  const expanded: Expanded[] = [];
  for (const a of aRows) {
    const masp = s(a.masp);
    if (!masp) continue;
    const bs = bByMasp.get(masp);
    if (!bs) continue; // INNER JOIN — masp không có định mức → loại
    const aSoluong = num0(a.soluong);
    const maddh = s(a.maddh);
    const mahtr = s(a.chitiet); // A.chitiet = mã hàng trắng
    for (const b of bs) {
      const soluong_tc = num(b.soluong_tc);
      const dayy_tc = num(b.dayy_tc);
      const rong_tc = num(b.rong_tc);
      const dai_tc = num(b.dai_tc);
      const sl = aSoluong * (soluong_tc ?? 0);
      const m3 = (num0(dayy_tc) * num0(rong_tc) * num0(dai_tc) * sl) / 1_000_000_000;
      const matchinh = s(b.veneer_matchinh);
      const matphu = s(b.veneer_matphu);
      const dancanh = s(b.veneer_dan_canh);
      const nl = mode === 0 ? nlById.get(s(b.id_nguyenlieu) ?? "") : undefined;
      const congdaiphoi = nl?.congdaiphoi ?? null;
      const row: Expanded = {
        maddh: mode === 0 ? null : maddh,
        tensp: mode === 2 ? (tenspByMasp.get(masp) ?? null) : null,
        mahtr: mode === 0 ? null : mahtr,
        chitiet: mode === 1 ? null : s(b.chitiet),
        nguyenlieu: s(b.nguyenlieu),
        chitiet_ghep2: num(b.chitiet_ghep2) === 1 ? "CHI TIẾT GHÉP" : "CHI TIẾT ĂN NGAY",
        dayy_tc,
        rong_tc,
        dai_tc,
        dayy_sc: num(b.dayy_sc),
        rong_sc: mode === 0 && rong_tc != null ? rong_tc + 1 : null,
        dai_sc: mode === 0 ? num0(congdaiphoi) + num0(dai_tc) : null,
        soluong_tc,
        soluong: sl,
        m3_tc: m3,
        ghichu: mode === 2 ? s(b.ghichu) : null,
        veneer_canhngan: s(b.veneer_canhngan),
        veneer_canhdai: s(b.veneer_canhdai),
        veneer_matchinh: matchinh,
        veneer_matphu: matphu,
        veneer_dan_canh: dancanh,
        mc: matchinh ? (loaihangById.get(matchinh) ?? null) : null,
        mp: matphu ? (loaihangById.get(matphu) ?? null) : null,
        dc: dancanh ? (loaihangById.get(dancanh) ?? null) : null,
        tilehaohut: mode === 0 ? (nl?.tilehaohut ?? null) : null,
        congdaiphoi: mode === 0 ? congdaiphoi : null,
        loaichitiet: loaiChitiet(dai_tc),
        _key: "",
      };
      expanded.push(row);
    }
  }
  if (expanded.length === 0) return [];

  // ===== GROUP BY theo mode (mode 2 = không gộp) =====
  const strip = (r: Expanded): TongHopRow => {
    const { _key, ...rest } = r;
    return rest;
  };
  if (mode === 2) return expanded.map(strip);

  // Khoá gộp: mode 0 bỏ maddh/mahtr (gộp toàn đơn); mode 1 giữ maddh+mahtr.
  const grouped = new Map<string, Expanded>();
  for (const r of expanded) {
    const dims = [
      mode === 1 ? r.maddh : "",
      mode === 1 ? r.mahtr : "",
      r.chitiet,
      r.nguyenlieu,
      r.chitiet_ghep2,
      r.dayy_tc,
      r.rong_tc,
      r.dai_tc,
      r.dayy_sc,
      r.soluong_tc,
      r.veneer_canhngan,
      r.veneer_canhdai,
      r.veneer_matchinh,
      r.veneer_matphu,
      r.veneer_dan_canh,
      r.mc,
      r.mp,
      r.dc,
      mode === 0 ? r.tilehaohut : "",
      mode === 0 ? r.congdaiphoi : "",
    ].join("");
    const cur = grouped.get(dims);
    if (cur) {
      cur.soluong += r.soluong;
      cur.m3_tc += r.m3_tc;
    } else {
      grouped.set(dims, { ...r });
    }
  }
  return [...grouped.values()].map(strip);
}
