/* Port TR_LENHCAPPHAT_SUMBYMACT — tổng số lượng cấp phát theo mã vật tư,
   kèm thông tin vật tư (mota/quycach/mausac/dvt/nhom) từ tr_material.
   Nguồn: migration-plan/ui/proc-bodies/tr_lenhcapphat_sumbymact.sql
   2 bảng thật → KHÔNG join 1 câu (biểu thức procTable không mang alias):
   tách 2 query + ghép trong JS (batch-stitch):
     1. aggregate trên tr_lenhcapphat (GROUP BY các cột a.*)
     2. lookup tr_material theo mavt (ISNULL(xoa,'N')='N')
   INNER JOIN gốc → nhóm không có vật tư khớp bị loại (giữ nguyên). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable, rows } from "../src/proc-table";

interface SumRow {
  lenh_cap_phat_id: string;
  loai_don_hang: string | null;
  loai_cap_phat: string | null;
  ma_don_hang: string | null;
  mavt: string | null;
  mota: string | null;
  quycach: string | null;
  mausac: string | null;
  soluong: number;
  dvt: string | null;
  ghichu: string | null;
  nhom: string | null;
}

export async function trLenhcapphatSumbymact(
  db: DB,
  companyId: string,
  args: {
    lenh_cap_phat_id: string;
  },
): Promise<SumRow[]> {
  if (!args.lenh_cap_phat_id) throw new Error("Thiếu lenh_cap_phat_id");

  const t = await procTable(db, companyId, "tr_lenhcapphat");

  // CASE chọn mã đơn hàng: madondathang rỗng/null → madonhang
  const maDonHang = sql`CASE
    WHEN ${t.text("madondathang")} = '' OR ${t.text("madondathang")} IS NULL
    THEN ${t.text("madonhang")}
    ELSE ${t.text("madondathang")}
  END`;

  // Bước 1: aggregate trên tr_lenhcapphat (ACTIVE = 1 → bool true)
  const res = await db.execute(sql`
    SELECT
      ${t.text("lenhcapphatid")} AS lenh_cap_phat_id,
      ${t.text("loaidonhang")} AS loai_don_hang,
      ${t.text("loaicapphat")} AS loai_cap_phat,
      ${maDonHang} AS ma_don_hang,
      ${t.text("mavt")} AS mavt,
      ${t.text("ghichu")} AS ghichu,
      SUM(${t.num("soluong")}) AS soluong
    FROM ${t.tbl}
    WHERE ${t.scope}
      AND ${t.text("lenhcapphatid")} = ${args.lenh_cap_phat_id}
      AND ${t.bool("active")} = true
    GROUP BY
      ${t.text("lenhcapphatid")},
      ${t.text("loaidonhang")},
      ${t.text("loaicapphat")},
      ${maDonHang},
      ${t.text("mavt")},
      ${t.text("ghichu")}
    HAVING SUM(${t.num("soluong")}) > 0
    ORDER BY ${t.text("mavt")}
  `);
  const sums = rows<{
    lenh_cap_phat_id: string;
    loai_don_hang: string | null;
    loai_cap_phat: string | null;
    ma_don_hang: string | null;
    mavt: string | null;
    ghichu: string | null;
    soluong: unknown;
  }>(res);
  if (sums.length === 0) return [];

  // Bước 2: lookup tr_material theo các mavt xuất hiện
  const mavts = [...new Set(sums.map((r) => r.mavt).filter((v): v is string => v != null))];
  const matByMavt = new Map<string, Record<string, unknown>>();
  if (mavts.length > 0) {
    const m = await procTable(db, companyId, "tr_material");
    const mats = await m.listWhere(sql`
      ${m.text("mavt")} IN (${sql.join(
        mavts.map((v) => sql`${v}`),
        sql`, `,
      )})
      AND COALESCE(${m.text("xoa")}, 'N') = 'N'
    `);
    for (const mat of mats) {
      const key = mat.mavt == null ? null : String(mat.mavt);
      if (key != null && !matByMavt.has(key)) matByMavt.set(key, mat);
    }
  }

  // Ghép: INNER JOIN → bỏ nhóm không có vật tư khớp
  const out: SumRow[] = [];
  for (const r of sums) {
    const mat = r.mavt == null ? undefined : matByMavt.get(r.mavt);
    if (!mat) continue;
    out.push({
      lenh_cap_phat_id: r.lenh_cap_phat_id,
      loai_don_hang: r.loai_don_hang,
      loai_cap_phat: r.loai_cap_phat,
      ma_don_hang: r.ma_don_hang,
      mavt: r.mavt,
      mota: mat.mota == null ? null : String(mat.mota),
      quycach: mat.quycach == null ? null : String(mat.quycach),
      mausac: mat.mausac == null ? null : String(mat.mausac),
      soluong: Number(r.soluong ?? 0),
      dvt: mat.dvt == null ? null : String(mat.dvt),
      ghichu: r.ghichu,
      nhom: mat.nhom == null ? null : String(mat.nhom),
    });
  }
  return out;
}
