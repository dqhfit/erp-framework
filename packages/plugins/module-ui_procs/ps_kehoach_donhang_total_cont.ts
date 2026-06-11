/* Port PS_KEHOACH_DONHANG_TOTAL_CONT — tổng số cont kế hoạch theo bộ phận,
   pivot 12 tháng (T1..T12) theo năm. soluong_cont = SUM(cont KẾT THÚC) -
   SUM(cont HOÀN THÀNH) per (bộ phận, cột, năm, tháng).
   Nguồn: migration-plan/ui/proc-bodies/ps_kehoach_donhang_total_cont.sql

   CHÚ Ý: 2 bảng ps_kehoach_donhang + tr_gridview_column CHƯA migrate sang
   PG — proc sẽ throw 'entity không tồn tại' khi gọi cho tới khi 2 bảng
   được migrate. 2 bảng không có trong field-map nên tên field giữ theo
   T-SQL gốc lowercase (columnname/columncaption/mabophan/macongdoan/
   tinhtong/formname; madonhang/typeid/columnname/ngaykehoach/trangthai/
   socont_kehoach).

   4 bảng → KHÔNG join 1 câu (biểu thức procTable không mang alias): port
   theo cách nhiều bước + ghép trong JS (batch-stitch):
     1. tr_gridview_column → danh sách cột tính tổng của form
        frmKeHoachSanXuatPO2 theo bộ phận (tương đương #GRIDCOLUMN)
     2. ps_kehoach_donhang → dòng kế hoạch NGAYKETTHUC/NGAYHOANTHANH theo
        columnname; lọc trangthai (COALESCE(trangthai,5) IN @trangthai)
        trong JS. Khối @minDay/@maxDay + BETWEEN của proc gốc tự khử
        (min/max tính trên CHÍNH tập lọc) — tác dụng duy nhất là loại dòng
        ngaykehoach NULL → JS chỉ cần bỏ dòng ngaykehoach null.
     3. tr_order (LEFT JOIN) → cont_qty fallback khi socont_kehoach NULL
     4. tr_bophan (LEFT JOIN) → tenbophan/tenkhac
     5. Pivot T1..T12 trong JS (2 tầng GROUP BY như #KEHOACH_CONT + select
        cuối); giá trị COALESCE(socont_kehoach, cont_qty) NULL → bỏ qua
        (SUM của SQL bỏ NULL); tháng không có dữ liệu → Tn = null. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

interface TotalContRow {
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

function splitList(v: string): string[] {
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function psKehoachDonhangTotalCont(
  db: DB,
  companyId: string,
  args: {
    bophan: string;
    trangthai: string;
  },
): Promise<TotalContRow[]> {
  if (!args.bophan) throw new Error("Thiếu bophan");
  if (!args.trangthai) throw new Error("Thiếu trangthai");

  const bophanList = splitList(args.bophan);
  const trangthaiSet = new Set(splitList(args.trangthai));
  if (bophanList.length === 0 || trangthaiSet.size === 0) return [];

  // Bước 1: #GRIDCOLUMN — cột tính tổng của form theo bộ phận.
  // FAIL-FAST: throw nếu tr_gridview_column chưa migrate.
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

  // Bước 2: dòng kế hoạch NGAYKETTHUC + NGAYHOANTHANH theo columnname.
  // FAIL-FAST: throw nếu ps_kehoach_donhang chưa migrate.
  const kh = await procTable(db, companyId, "ps_kehoach_donhang");
  const khRows = await kh.listWhere(sql`
    ${kh.text("columnname")} IN (${sql.join(
      [...gcByColumn.keys()].map((v) => sql`${v}`),
      sql`, `,
    )})
    AND ${kh.raw("madonhang")} IS NOT NULL
    AND ${kh.text("typeid")} IN (${"NGAYKETTHUC"}, ${"NGAYHOANTHANH"})
  `);

  // Lọc trangthai + ngaykehoach trong JS (xem comment đầu file)
  const plans = khRows.filter((r) => {
    const tt = r.trangthai == null ? 5 : r.trangthai;
    if (!trangthaiSet.has(String(tt).trim())) return false;
    return ymOf(r.ngaykehoach) != null;
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

  // Bước 5a: tương đương #KEHOACH_CONT — gom (nhóm, năm, tháng) → sumK/sumH
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
    sumH: number;
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
      sumH: 0,
    };
    const key = [b.mabophan, b.tenbophan, b.tenkhac, b.macongdoan, b.columnCaption, b.nam, b.thang]
      .map((v) => String(v))
      .join("\u0001");
    const cur = buckets.get(key) ?? b;
    if (String(r.typeid) === "NGAYKETTHUC") cur.sumK += val;
    else cur.sumH += val;
    buckets.set(key, cur);
  }

  // Bước 5b: pivot T1..T12 theo (nhóm, năm) — Tn = sumK - sumH của tháng n,
  // tháng không có dữ liệu → null (SUM(CASE...) của SQL trả NULL)
  const out = new Map<string, TotalContRow>();
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
      TotalContRow,
      "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7" | "T8" | "T9" | "T10" | "T11" | "T12"
    >;
    row[tKey] = (row[tKey] ?? 0) + (b.sumK - b.sumH);
  }

  // Proc gốc không ORDER BY câu cuối — sort nhẹ cho output ổn định
  return [...out.values()].sort(
    (a, z) =>
      (a.mabophan ?? "").localeCompare(z.mabophan ?? "") ||
      (a.columnCaption ?? "").localeCompare(z.columnCaption ?? "") ||
      a.nam - z.nam,
  );
}
