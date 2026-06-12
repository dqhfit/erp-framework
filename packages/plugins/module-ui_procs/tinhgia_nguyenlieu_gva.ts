/* Port TINHGIA_NGUYENLIEU_GVA (bản 1) — tổng giá nguyên liệu gỗ ván (VND)
   + tổng khối tinh chế của 1 sản phẩm.
   Nguồn: migration-plan/ui/proc-bodies/tinhgia_nguyenlieu_gva.sql
   Cấu trúc Y HỆT TINHGIA_NGUYENLIEU_GVA2 (xem tinhgia_nguyenlieu_gva2.ts),
   khác DUY NHẤT: dùng FN_DONGIA_NGUYENLIEU_GVA (bản 1) — nhánh "dai >
   MAX(dai_den)" và nhánh fallback lấy thẳng `dongia`, KHÔNG ưu tiên
   `gianhap` như FN GVA4. Được TINHGIA_HANGMUC_SANPHAM nhánh 10 gọi. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable, rows } from "../src/proc-table";

interface GiaRow {
  id_nguyenlieu: string | null;
  nguyenlieu: string | null;
  dayy: number;
  dai_tu: number;
  dai_den: number;
  dongia: number;
  loaitien: string;
}

/* Port FN_DONGIA_NGUYENLIEU_GVA (bản 1) — như GVA4 nhưng target giá luôn
   là `dongia` (không có nhánh gianhap). */
function fnDongiaNguyenlieuGva(
  all: GiaRow[],
  dayy: number,
  dai: number,
): { dongia: number; loaitien: string } | null {
  if (all.length === 0) return null;

  const cungDayy = all.filter((r) => r.dayy === dayy);
  const maxDaiDen = cungDayy.length > 0 ? Math.max(...cungDayy.map((r) => r.dai_den)) : null;

  let matched: GiaRow[];
  if (maxDaiDen != null && dai > maxDaiDen) {
    const top = [...cungDayy].sort((a, b) => b.dai_den - a.dai_den)[0];
    const target = top ? top.dongia : Number.NaN;
    matched = all.filter((r) => r.dongia === target);
  } else if (cungDayy.some((r) => dai >= r.dai_tu && dai < r.dai_den)) {
    matched = all.filter((r) => dai >= r.dai_tu && dai < r.dai_den);
  } else {
    const top = [...all].sort((a, b) => b.dongia - a.dongia)[0];
    const target = top ? top.dongia : Number.NaN;
    matched = all.filter((r) => r.dongia === target);
  }
  const hit = matched[0];
  return hit ? { dongia: hit.dongia, loaitien: hit.loaitien } : null;
}

export async function tinhgiaNguyenlieuGva(
  db: DB,
  companyId: string,
  args: {
    masp: string;
    tigia?: number;
  },
): Promise<Array<{ tongdongia_vnd: number; tongkhoitinhche: number }>> {
  if (!args.masp) throw new Error("Thiếu masp");

  // T-SQL: @tigia float = 25400
  const tigia = args.tigia ?? 25400;

  const t = await procTable(db, companyId, "tr_dinhmuc_govan");
  const res = await db.execute(sql`
    SELECT ${t.text("nguyenlieu")} AS nguyenlieu,
           ${t.num("dayy_tc")} AS dayy_tc,
           ${t.num("rong_tc")} AS rong_tc,
           ${t.num("dai_tc")} AS dai_tc,
           ${t.num("soluong_tc")} AS soluong_tc
    FROM ${t.tbl}
    WHERE ${t.scope}
      AND ${t.text("masp")} = ${args.masp}
      AND ${t.text("nguyenlieu")} NOT IN ('', '0')
  `);
  const dmRows = rows<{
    nguyenlieu: string;
    dayy_tc: unknown;
    rong_tc: unknown;
    dai_tc: unknown;
    soluong_tc: unknown;
  }>(res);

  const keys = [...new Set(dmRows.map((r) => r.nguyenlieu).filter((v) => v != null))];
  let giaRows: GiaRow[] = [];
  if (keys.length > 0) {
    const tg = await procTable(db, companyId, "tr_dongia_nguyenlieu_gva");
    const inList = sql.join(
      keys.map((v) => sql`${v}`),
      sql`, `,
    );
    const raw = await tg.listWhere(
      sql`${tg.text("id_nguyenlieu")} IN (${inList}) OR ${tg.text("nguyenlieu")} IN (${inList})`,
    );
    giaRows = raw.map((r) => ({
      id_nguyenlieu: r.id_nguyenlieu == null ? null : String(r.id_nguyenlieu),
      nguyenlieu: r.nguyenlieu == null ? null : String(r.nguyenlieu),
      dayy: Number(r.dayy ?? 0),
      dai_tu: Number(r.dai_tu ?? 0),
      dai_den: Number(r.dai_den ?? 0),
      dongia: Number(r.dongia ?? 0),
      loaitien: r.loaitien == null ? "" : String(r.loaitien),
    }));
  }

  let tongdongiaVnd = 0;
  let tongkhoitinhche = 0;
  for (const r of dmRows) {
    const dayyTc = Number(r.dayy_tc ?? 0);
    const daiTc = Number(r.dai_tc ?? 0);
    const sokhoiTC =
      (dayyTc * Number(r.rong_tc ?? 0) * daiTc * Number(r.soluong_tc ?? 0)) / 1_000_000_000;

    const cuaKey = giaRows.filter(
      (g) => g.id_nguyenlieu === r.nguyenlieu || g.nguyenlieu === r.nguyenlieu,
    );
    const gia = fnDongiaNguyenlieuGva(cuaKey, dayyTc, daiTc);
    let dongia = gia?.dongia ?? 0;
    if ((gia?.loaitien ?? "") === "USD") dongia = dongia * tigia;

    tongdongiaVnd += dongia * sokhoiTC;
    tongkhoitinhche += sokhoiTC;
  }

  return [{ tongdongia_vnd: tongdongiaVnd, tongkhoitinhche }];
}
