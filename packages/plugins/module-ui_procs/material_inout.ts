/* Port MATERIAL_INOUT — báo cáo NHẬP-XUẤT vật tư theo kho + khoảng ngày.
   Nguồn: migration-plan/ui/proc-bodies/material_inout.sql (form frmListMaterialInOut, R46).

   Logic gốc: UNION ALL 2 nhánh (Nhập kho từ tr_ctphieunhap×tr_phieunhap,
   Xuất kho từ tr_ctphieuxuat×tr_phieuxuat) trong kỳ + đúng kho, GROUP BY
   gộp dòng trùng (SUM soluong), rồi INNER JOIN tr_material (theo
   mact = material.idxuong → lấy mota/quycach/mausac/dvt) + LEFT JOIN
   tr_reftype (reftypename).

   proc-table sinh biểu thức cột KHÔNG qualify bảng → không JOIN SQL nhiều
   bảng được (collision f_*). Theo pattern tr_baocao_chuyenson_getdata:
   query từng bảng + ghép JS (batch-stitch). INNER JOIN material = LOẠI dòng
   không khớp idxuong (giữ đúng ngữ nghĩa gốc). */
import type { DB } from "@erp-framework/server/db";
import { type SQL, sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

interface InOutRow {
  sophieu: string | null;
  ghichu2: string | null;
  mact: string | null;
  bengiao: string | null;
  donhang: string | null;
  trangthai: string;
  ngaythang: string | null;
  ngayphieu: string | null;
  makho: string | null;
  ghichu: string | null;
  dongia: number | null;
  reftype: string | null;
  soluong: number;
  mota: string | null;
  quycach: string | null;
  mausac: string | null;
  dvt: string | null;
  reftypename: string | null;
}

const s = (v: unknown): string | null => (v == null ? null : String(v));
const dateOnly = (v: unknown): string | null => {
  const t = s(v);
  return t ? t.slice(0, 10) : null;
};
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** Mệnh đề IN an toàn cho danh sách text (rỗng → null = không khớp gì). */
function inText(expr: SQL, vals: string[]) {
  return sql`${expr} IN (${sql.join(
    vals.map((v) => sql`${v}`),
    sql`, `,
  )})`;
}

export async function materialInout(
  db: DB,
  companyId: string,
  args: { makho?: string; tungay?: string; denngay?: string },
): Promise<InOutRow[]> {
  const makho = String(args.makho ?? "").trim();
  const tungay = String(args.tungay ?? "").slice(0, 10);
  const denngay = String(args.denngay ?? "").slice(0, 10);
  if (!makho) throw new Error("Thiếu mã kho (makho)");
  if (!tungay || !denngay) throw new Error("Thiếu khoảng ngày (tungay/denngay)");

  type Raw = Omit<InOutRow, "soluong" | "mota" | "quycach" | "mausac" | "dvt" | "reftypename"> & {
    soluong: number;
  };
  const raws: Raw[] = [];

  // ===== NHẬP =====
  const ph = await procTable(db, companyId, "tr_phieunhap");
  const nhapHeaders = await ph.listWhere(sql`
    ${ph.bool("active")} = true
    AND ${ph.text("makho")} = ${makho}
    AND (${ph.ts("ngaynhap")})::date BETWEEN ${tungay}::date AND ${denngay}::date
  `);
  if (nhapHeaders.length > 0) {
    const hBySopn = new Map<string, Record<string, unknown>>();
    for (const h of nhapHeaders) {
      const k = s(h.sopn);
      if (k != null && !hBySopn.has(k)) hBySopn.set(k, h);
    }
    const sopns = [...hBySopn.keys()];
    const cn = await procTable(db, companyId, "tr_ctphieunhap");
    const details = await cn.listWhere(sql`
      ${inText(cn.text("sopn"), sopns)}
      AND (COALESCE(${cn.num("slnhap")}, 0) + COALESCE(${cn.num("soluong_du")}, 0)) > 0
    `);
    for (const d of details) {
      const h = hBySopn.get(String(d.sopn ?? ""));
      if (!h) continue;
      raws.push({
        sophieu: s(d.sopn),
        ghichu2: s(h.ghichu),
        mact: s(d.mavt),
        bengiao: s(h.tenncc),
        donhang: s(d.id_dathang),
        trangthai: "Nhập kho",
        ngaythang: dateOnly(h.ngaynhap),
        ngayphieu: dateOnly(h.ngayphieu),
        makho: s(h.makho),
        ghichu: s(d.ghichu),
        dongia: num(d.gianhap),
        reftype: s(h.reftype),
        soluong: num(d.slnhap) ?? 0,
      });
    }
  }

  // ===== XUẤT =====
  const px = await procTable(db, companyId, "tr_phieuxuat");
  const xuatHeaders = await px.listWhere(sql`
    ${px.bool("active")} = true
    AND ${px.text("makho")} = ${makho}
    AND (${px.ts("ngaytao")})::date BETWEEN ${tungay}::date AND ${denngay}::date
  `);
  if (xuatHeaders.length > 0) {
    const hBySopx = new Map<string, Record<string, unknown>>();
    for (const h of xuatHeaders) {
      const k = s(h.sopx);
      if (k != null && !hBySopx.has(k)) hBySopx.set(k, h);
    }
    const sopxs = [...hBySopx.keys()];
    const cx = await procTable(db, companyId, "tr_ctphieuxuat");
    const details = await cx.listWhere(sql`
      ${inText(cx.text("phieuxuat"), sopxs)}
      AND COALESCE(${cx.num("soluong")}, 0) > 0
    `);
    for (const d of details) {
      const h = hBySopx.get(String(d.phieuxuat ?? ""));
      if (!h) continue;
      raws.push({
        sophieu: s(d.phieuxuat),
        ghichu2: s(h.ghichu),
        mact: s(d.mact),
        bengiao: s(h.nguoinhan),
        donhang: s(d.lenhcapphat),
        trangthai: "Xuất kho",
        ngaythang: dateOnly(h.ngaytao),
        ngayphieu: dateOnly(h.ngaytao),
        makho: s(h.makho),
        ghichu: s(d.ghichu),
        dongia: num(d.giaxuat),
        reftype: s(h.reftype),
        soluong: num(d.soluong) ?? 0,
      });
    }
  }

  if (raws.length === 0) return [];

  // ===== GROUP BY (gộp dòng trùng, SUM soluong) =====
  const SEP = "";
  const grouped = new Map<string, Raw>();
  for (const r of raws) {
    const key = [
      r.sophieu,
      r.ghichu2,
      r.donhang,
      r.mact,
      r.bengiao,
      r.trangthai,
      r.ngaythang,
      r.ngayphieu,
      r.makho,
      r.ghichu,
      r.dongia,
      r.reftype,
    ].join(SEP);
    const cur = grouped.get(key);
    if (cur) cur.soluong += r.soluong;
    else grouped.set(key, { ...r });
  }
  const agg = [...grouped.values()];

  // ===== Enrich tr_material (INNER JOIN theo idxuong) + tr_reftype (LEFT) =====
  const macts = [...new Set(agg.map((r) => r.mact).filter((v): v is string => !!v))];
  const matByIdxuong = new Map<string, Record<string, unknown>>();
  if (macts.length > 0) {
    const mat = await procTable(db, companyId, "tr_material");
    const mrows = await mat.listWhere(inText(mat.text("idxuong"), macts));
    for (const m of mrows) {
      const k = s(m.idxuong);
      if (k != null && !matByIdxuong.has(k)) matByIdxuong.set(k, m);
    }
  }
  const reftypes = [...new Set(agg.map((r) => r.reftype).filter((v): v is string => !!v))];
  const refNameByType = new Map<string, string | null>();
  if (reftypes.length > 0) {
    const rt = await procTable(db, companyId, "tr_reftype");
    const rrows = await rt.listWhere(inText(rt.text("reftype"), reftypes));
    for (const r of rrows) {
      const k = s(r.reftype);
      if (k != null && !refNameByType.has(k)) refNameByType.set(k, s(r.reftypename));
    }
  }

  const out: InOutRow[] = [];
  for (const r of agg) {
    const m = r.mact ? matByIdxuong.get(r.mact) : undefined;
    if (!m) continue; // INNER JOIN tr_material — loại dòng không khớp idxuong
    out.push({
      ...r,
      mota: s(m.mota),
      quycach: s(m.quycach),
      mausac: s(m.mausac),
      dvt: s(m.dvt),
      reftypename: r.reftype ? (refNameByType.get(r.reftype) ?? null) : null,
    });
  }

  // ORDER BY mact (proc gốc)
  return out.sort((a, z) => (a.mact ?? "").localeCompare(z.mact ?? ""));
}
