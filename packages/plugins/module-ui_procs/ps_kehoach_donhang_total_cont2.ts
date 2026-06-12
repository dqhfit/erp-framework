/* Port PS_KEHOACH_DONHANG_TOTAL_CONT2 — biến thể của TOTAL_CONT: tổng số
   cont kế hoạch theo bộ phận, pivot 12 tháng (T1..T12) theo năm; lọc theo
   danh sách NĂM + THÁNG (CSV) thay vì trạng thái.
   Nguồn: migration-plan/ui/proc-bodies/ps_kehoach_donhang_total_cont2.sql

   Khác TOTAL_CONT: chỉ lấy typeid = 'NGAYKETTHUC' (soluong_cont_HOANTHANH
   luôn 0 trong proc gốc → soluong_cont = SUM(cont KẾT THÚC)); KHÔNG lọc
   trangthai; thêm lọc YEAR/MONTH(ngaykehoach) IN @nam/@thang.

   CHÚ Ý: bảng ps_kehoach_donhang CHƯA migrate sang PG (PK ghép) — proc sẽ
   throw 'entity không tồn tại' (fail-fast) khi gọi cho tới khi bảng được
   migrate. tr_gridview_column ĐÃ import (import-items.json: columnname/
   columncaption/formname/mabophan/macongdoan/tinhtong lowercase).

   4 bảng → KHÔNG join 1 câu (biểu thức procTable không mang alias): port
   nhiều bước + ghép trong JS (batch-stitch), cùng pattern TOTAL_CONT:
     1. tr_gridview_column → cột tính tổng của form frmKeHoachSanXuatPO2
        theo bộ phận (tương đương #GRIDCOLUMN)
     2. ps_kehoach_donhang → dòng NGAYKETTHUC theo columnname; lọc
        năm/tháng của ngaykehoach trong JS
     3. tr_order (LEFT JOIN) → cont_qty fallback khi socont_kehoach NULL
     4. tr_bophan (LEFT JOIN) → tenbophan/tenkhac
     5. Pivot T1..T12 trong JS; giá trị COALESCE(socont_kehoach, cont_qty)
        NULL → bỏ qua (SUM của SQL bỏ NULL); tháng không có dữ liệu →
        Tn = null. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

interface TotalCont2Row {
  mabophan: string | null;
  tenbophan: string | null;
  tenkhac: string | null;
  macongdoan: string | null;
  columnCaption: string | null;
  nam: number;
  T1: number | null;
  T2: number | null;
  T3: number | null;
  T4: number | null;
  T5: number | null;
  T6: number | null;
  T7: number | null;
  T8: number | null;
  T9: number | null;
  T10: number | null;
  T11: number | null;
  T12: number | null;
}

/** Tách năm/tháng từ giá trị ngày (Date hoặc chuỗi ISO/date-only) — đọc
 *  theo phần chữ "YYYY-MM" để khỏi lệch timezone (bài học #9). */
function ymOf(v: unknown): { nam: number; thang: number } | null {
  if (v == null) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return { nam: v.getUTCFullYear(), thang: v.getUTCMonth() + 1 };
  }
  const m = /^(\d{4})-(\d{2})/.exec(String(v));
  return m ? { nam: Number(m[1]), thang: Number(m[2]) } : null;
}

/** CSV param → mảng số (LTRIM/RTRIM của string_split → trim JS). */
function splitNums(v: string): number[] {
  return v
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}

function splitList(v: string): string[] {
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function psKehoachDonhangTotalCont2(
  db: DB,
  companyId: string,
  args: {
    bophan: string;
    nam: string;
    thang: string;
  },
): Promise<TotalCont2Row[]> {
  if (!args.bophan) throw new Error("Thiếu bophan");
  if (!args.nam) throw new Error("Thiếu nam");
  if (!args.thang) throw new Error("Thiếu thang");

  const bophanList = splitList(args.bophan);
  const namSet = new Set(splitNums(args.nam));
  const thangSet = new Set(splitNums(args.thang));
  if (bophanList.length === 0 || namSet.size === 0 || thangSet.size === 0) return [];

  // Bước 1: #GRIDCOLUMN — cột tính tổng của form theo bộ phận.
  const gc = await procTable(db, companyId, "tr_gridview_column");
  const gridcols = await gc.listWhere(sql`
    ${gc.text("mabophan")} IN (${sql.join(
      bophanList.map((v) => sql`${v}`),
      sql`, `,
    )})
    AND ${gc.bool("tinhtong")} = true
    AND ${gc.text("formname")} = ${"frmKeHoachSanXuatPO2"}
  `);
  if (gridcols.length === 0) return [];
  const gcByColumn = new Map<string, Record<string, unknown>>();
  for (const g of gridcols) {
    if (g.columnname != null) gcByColumn.set(String(g.columnname), g);
  }
  if (gcByColumn.size === 0) return [];

  // Bước 2: dòng kế hoạch NGAYKETTHUC theo columnname.
  // FAIL-FAST: throw nếu ps_kehoach_donhang chưa migrate (xem comment đầu file).
  const kh = await procTable(db, companyId, "ps_kehoach_donhang");
  const khRows = await kh.listWhere(sql`
    ${kh.text("columnname")} IN (${sql.join(
      [...gcByColumn.keys()].map((v) => sql`${v}`),
      sql`, `,
    )})
    AND ${kh.raw("madonhang")} IS NOT NULL
    AND ${kh.text("typeid")} = ${"NGAYKETTHUC"}
  `);

  // Lọc YEAR/MONTH(ngaykehoach) IN @nam/@thang trong JS
  const plans = khRows.filter((r) => {
    const ym = ymOf(r.ngaykehoach);
    return ym != null && namSet.has(ym.nam) && thangSet.has(ym.thang);
  });
  if (plans.length === 0) return [];

  // Bước 3: tr_order — cont_qty theo order_number (LEFT JOIN → thiếu = null)
  const madonhangs = [
    ...new Set(
      plans
        .map((r) => r.madonhang)
        .filter((v): v is string => v != null)
        .map(String),
    ),
  ];
  const contQtyByOrder = new Map<string, number | null>();
  if (madonhangs.length > 0) {
    const o = await procTable(db, companyId, "tr_order");
    const orders = await o.listWhere(sql`
      ${o.text("order_number")} IN (${sql.join(
        madonhangs.map((v) => sql`${v}`),
        sql`, `,
      )})
    `);
    for (const ord of orders) {
      if (ord.order_number == null) continue;
      contQtyByOrder.set(
        String(ord.order_number),
        ord.cont_qty == null ? null : Number(ord.cont_qty),
      );
    }
  }

  // Bước 4: tr_bophan — tenbophan/tenkhac (LEFT JOIN → thiếu = null)
  const mabophans = [
    ...new Set(
      gridcols
        .map((g) => g.mabophan)
        .filter((v): v is string => v != null)
        .map(String),
    ),
  ];
  const bpByMa = new Map<string, Record<string, unknown>>();
  if (mabophans.length > 0) {
    const bp = await procTable(db, companyId, "tr_bophan");
    const bps = await bp.listWhere(sql`
      ${bp.text("mabophan")} IN (${sql.join(
        mabophans.map((v) => sql`${v}`),
        sql`, `,
      )})
    `);
    for (const b of bps) {
      const key = b.mabophan == null ? null : String(b.mabophan);
      if (key != null && !bpByMa.has(key)) bpByMa.set(key, b);
    }
  }

  // Bước 5a: tương đương #KEHOACH_CONT — gom (nhóm, năm, tháng) → sumK.
  // Proc gốc chỉ có dòng KẾT THÚC (HOÀN THÀNH = 0) → soluong_cont = sumK.
  const asText = (v: unknown): string | null => (v == null ? null : String(v));
  interface Bucket {
    mabophan: string | null;
    tenbophan: string | null;
    tenkhac: string | null;
    macongdoan: string | null;
    columnCaption: string | null;
    nam: number;
    thang: number;
    sumK: number;
  }
  const buckets = new Map<string, Bucket>();
  for (const r of plans) {
    const g = r.columnname == null ? undefined : gcByColumn.get(String(r.columnname));
    if (!g) continue; // INNER JOIN #GRIDCOLUMN
    const ym = ymOf(r.ngaykehoach);
    if (!ym) continue;
    // COALESCE(A.socont_kehoach, C.cont_qty) — NULL → SUM bỏ qua dòng
    const fallback = r.madonhang == null ? null : (contQtyByOrder.get(String(r.madonhang)) ?? null);
    const val = r.socont_kehoach == null ? fallback : Number(r.socont_kehoach);
    if (val == null || !Number.isFinite(val)) continue;
    const mabophan = asText(g.mabophan);
    const bpInfo = mabophan == null ? undefined : bpByMa.get(mabophan);
    const b: Bucket = {
      mabophan,
      tenbophan: asText(bpInfo?.tenbophan),
      tenkhac: asText(bpInfo?.tenkhac),
      macongdoan: asText(g.macongdoan),
      columnCaption: asText(g.columncaption),
      nam: ym.nam,
      thang: ym.thang,
      sumK: 0,
    };
    const key = [b.mabophan, b.tenbophan, b.tenkhac, b.macongdoan, b.columnCaption, b.nam, b.thang]
      .map((v) => String(v))
      .join("\u0001");
    const cur = buckets.get(key) ?? b;
    cur.sumK += val;
    buckets.set(key, cur);
  }

  // Bước 5b: pivot T1..T12 theo (nhóm, năm) — Tn = sumK của tháng n,
  // tháng không có dữ liệu → null (SUM(CASE...) của SQL trả NULL)
  const out = new Map<string, TotalCont2Row>();
  for (const b of buckets.values()) {
    const key = [b.mabophan, b.tenbophan, b.tenkhac, b.macongdoan, b.columnCaption, b.nam]
      .map((v) => String(v))
      .join("\u0001");
    let row = out.get(key);
    if (!row) {
      row = {
        mabophan: b.mabophan,
        tenbophan: b.tenbophan,
        tenkhac: b.tenkhac,
        macongdoan: b.macongdoan,
        columnCaption: b.columnCaption,
        nam: b.nam,
        T1: null,
        T2: null,
        T3: null,
        T4: null,
        T5: null,
        T6: null,
        T7: null,
        T8: null,
        T9: null,
        T10: null,
        T11: null,
        T12: null,
      };
      out.set(key, row);
    }
    const tKey = `T${b.thang}` as keyof Pick<
      TotalCont2Row,
      "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7" | "T8" | "T9" | "T10" | "T11" | "T12"
    >;
    row[tKey] = (row[tKey] ?? 0) + b.sumK;
  }

  // Proc gốc không ORDER BY câu cuối — sort nhẹ cho output ổn định
  return [...out.values()].sort(
    (a, z) =>
      (a.mabophan ?? "").localeCompare(z.mabophan ?? "") ||
      (a.columnCaption ?? "").localeCompare(z.columnCaption ?? "") ||
      a.nam - z.nam,
  );
}
