/* Port TR_TINHGIA_BY_DDH — tổng hợp số khối sản xuất theo công đoạn cho
   1 đơn đặt hàng, nhân hệ số hệ hàng (sokhoi1 = sokhoi * heso).
   Nguồn: migration-plan/ui/proc-bodies/tr_tinhgia_by_ddh.sql

   5 bảng + 2 bảng tạm → KHÔNG join 1 câu (biểu thức procTable không mang
   alias): tách query + dựng 2 bảng tạm trong JS (batch-stitch + group):
     1. #DANHSACH_CONGDOAN = trtb_m_op (active) x trtb_m_location (active)
        join trên c_op → (c_op, n_op, c_location, department). Một
        c_location khớp nhiều dòng op → giữ DANH SÁCH (join nhân bản dòng
        y như SQL). Lọc department NOT IN ('SON','UV','DONGGOI') ngay khi
        dựng index — NOT IN của SQL loại luôn department NULL.
     2. tr_trangthai_sanxuat theo madonhang + congdoan LIKE '%-PROD';
        INNER JOIN #DANHSACH_CONGDOAN trên congdoan = c_location và
        tr_sanpham trên masp1 = masp (lấy hehang) — không khớp → loại.
        Khối lượng mỗi dòng theo CASE:
          mact = '000'                          → soluong * sokhoi
          nguyenlieu không rỗng/khác '0' và mact <> '000' → sokhoi
          còn lại (kể cả mact NULL — <> '000' với NULL là unknown) → 0
        GROUP BY (madonhang, masp1, hehang, ngaythang, c_op, n_op) →
        #TRANGTHAI_SANXUAT. SUM bỏ NULL; nhóm toàn NULL → null.
     3. tr_hehang LEFT JOIN trên hehang = tenhh → heso (COALESCE 1);
        giả định tenhh duy nhất (bảng danh mục) — trùng lấy dòng đầu.
     4. GROUP BY (macongdoan, tencongdoan, madonhang, hehang, heso) →
        songay = COUNT(DISTINCT ngaythang), tungay/denngay = MIN/MAX,
        sokhoi = SUM; trả thêm sokhoi1 = sokhoi * heso.

   ngaythang chuẩn hoá về chuỗi 'YYYY-MM-DD' qua getUTC* (bài học #9 —
   tránh lệch ±1 ngày theo timezone); tungay/denngay trả chuỗi ngày. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

interface TinhgiaByDdhRow {
  macongdoan: string | null;
  tencongdoan: string | null;
  madonhang: string | null;
  hehang: string | null;
  heso: number;
  songay: number;
  tungay: string | null;
  denngay: string | null;
  sokhoi: number | null;
  sokhoi1: number | null;
}

/** Ép giá trị về number, không hợp lệ/null → null (SUM của SQL bỏ NULL). */
function numOf(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Chuẩn hoá giá trị ngày về 'YYYY-MM-DD' (Date → getUTC*, chuỗi → cắt
 *  phần đầu ISO) — null/không nhận dạng được → null. */
function dayKey(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const mm = String(v.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(v.getUTCDate()).padStart(2, "0");
    return `${v.getUTCFullYear()}-${mm}-${dd}`;
  }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  return m?.[1] ?? null;
}

export async function trTinhgiaByDdh(
  db: DB,
  companyId: string,
  args: { madonhang: string },
): Promise<TinhgiaByDdhRow[]> {
  if (!args.madonhang) throw new Error("Thiếu madonhang");

  const asText = (v: unknown): string | null => (v == null ? null : String(v));

  // Bước 1: #DANHSACH_CONGDOAN — trtb_m_op x trtb_m_location (đều active)
  const op = await procTable(db, companyId, "trtb_m_op");
  const ops = await op.listWhere(sql`${op.bool("active")} = true`);
  const loc = await procTable(db, companyId, "trtb_m_location");
  const locs = await loc.listWhere(sql`${loc.bool("active")} = true`);

  // c_op → danh sách dòng op (join nhân bản nếu 1 c_op có nhiều dòng op).
  // Lọc department khác SON/UV/DONGGOI ngay tại đây (NULL cũng bị loại —
  // ngữ nghĩa NOT IN của SQL).
  const opsByCop = new Map<string, Array<{ c_op: string; n_op: string | null }>>();
  for (const o of ops) {
    if (o.c_op == null) continue;
    const dept = asText(o.department);
    if (dept == null || ["SON", "UV", "DONGGOI"].includes(dept)) continue;
    const key = String(o.c_op);
    const list = opsByCop.get(key) ?? [];
    list.push({ c_op: key, n_op: asText(o.n_op) });
    opsByCop.set(key, list);
  }
  // c_location → danh sách công đoạn (c_op, n_op) — tích op x location
  const congdoanByLocation = new Map<string, Array<{ c_op: string; n_op: string | null }>>();
  for (const l of locs) {
    if (l.c_location == null || l.c_op == null) continue;
    const matched = opsByCop.get(String(l.c_op));
    if (!matched || matched.length === 0) continue; // INNER JOIN
    const key = String(l.c_location);
    const list = congdoanByLocation.get(key) ?? [];
    list.push(...matched);
    congdoanByLocation.set(key, list);
  }

  // Bước 2a: tr_trangthai_sanxuat theo đơn hàng + công đoạn '%-PROD'
  const tt = await procTable(db, companyId, "tr_trangthai_sanxuat");
  const ttRows = await tt.listWhere(sql`
    ${tt.text("madonhang")} = ${args.madonhang}
    AND ${tt.text("congdoan")} LIKE ${"%-PROD"}
  `);
  if (ttRows.length === 0) return [];

  // Bước 2b: tr_sanpham — hehang theo masp (INNER JOIN trên masp1 = masp;
  // giữ danh sách phòng masp trùng dòng — join SQL nhân bản y vậy)
  const masps = [
    ...new Set(
      ttRows
        .map((r) => r.masp1)
        .filter((v): v is string => v != null)
        .map(String),
    ),
  ];
  const hehangByMasp = new Map<string, Array<string | null>>();
  if (masps.length > 0) {
    const sp = await procTable(db, companyId, "tr_sanpham");
    const sps = await sp.listWhere(sql`
      ${sp.text("masp")} IN (${sql.join(
        masps.map((v) => sql`${v}`),
        sql`, `,
      )})
    `);
    for (const s of sps) {
      if (s.masp == null) continue;
      const key = String(s.masp);
      const list = hehangByMasp.get(key) ?? [];
      list.push(asText(s.hehang));
      hehangByMasp.set(key, list);
    }
  }

  // Bước 2c: gom #TRANGTHAI_SANXUAT — key (masp1, hehang, ngay, c_op, n_op)
  // (madonhang hằng số = tham số nên không cần vào key)
  interface Stage1 {
    masp1: string | null;
    hehang: string | null;
    ngay: string | null;
    c_op: string;
    n_op: string | null;
    sokhoi: number | null;
  }
  const stage1 = new Map<string, Stage1>();
  for (const r of ttRows) {
    const congdoans = r.congdoan == null ? undefined : congdoanByLocation.get(String(r.congdoan));
    if (!congdoans || congdoans.length === 0) continue; // INNER JOIN #DANHSACH_CONGDOAN
    const hehangs = r.masp1 == null ? undefined : hehangByMasp.get(String(r.masp1));
    if (!hehangs || hehangs.length === 0) continue; // INNER JOIN tr_sanpham

    // CASE khối lượng — null = đóng góp NULL (SUM bỏ qua)
    const mact = asText(r.mact);
    const soluong = numOf(r.soluong);
    const sokhoi = numOf(r.sokhoi);
    let val: number | null;
    if (mact === "000") {
      val = soluong == null || sokhoi == null ? null : soluong * sokhoi;
    } else {
      const nl = r.nguyenlieu == null ? "" : String(r.nguyenlieu);
      // mact <> '000' với mact NULL là unknown trong SQL → rơi về ELSE 0
      val = nl !== "" && nl !== "0" && mact != null ? sokhoi : 0;
    }

    const ngay = dayKey(r.ngaythang);
    for (const cd of congdoans) {
      for (const hh of hehangs) {
        const key = [r.masp1, hh, ngay, cd.c_op, cd.n_op].map((v) => String(v)).join("\u0001");
        let b = stage1.get(key);
        if (!b) {
          b = {
            masp1: asText(r.masp1),
            hehang: hh,
            ngay,
            c_op: cd.c_op,
            n_op: cd.n_op,
            sokhoi: null,
          };
          stage1.set(key, b);
        }
        if (val != null) b.sokhoi = (b.sokhoi ?? 0) + val;
      }
    }
  }
  if (stage1.size === 0) return [];

  // Bước 3: tr_hehang — heso theo tenhh (LEFT JOIN, thiếu → COALESCE 1)
  const hehangs = [
    ...new Set([...stage1.values()].map((b) => b.hehang).filter((v): v is string => v != null)),
  ];
  const hesoByTenhh = new Map<string, number | null>();
  if (hehangs.length > 0) {
    const hh = await procTable(db, companyId, "tr_hehang");
    const hhRows = await hh.listWhere(sql`
      ${hh.text("tenhh")} IN (${sql.join(
        hehangs.map((v) => sql`${v}`),
        sql`, `,
      )})
    `);
    for (const h of hhRows) {
      const key = h.tenhh == null ? null : String(h.tenhh);
      if (key != null && !hesoByTenhh.has(key)) hesoByTenhh.set(key, numOf(h.heso));
    }
  }

  // Bước 4: GROUP BY (macongdoan, tencongdoan, hehang, heso) — COUNT
  // DISTINCT ngày + MIN/MAX ngày + SUM sokhoi (bỏ NULL)
  interface Stage2 {
    macongdoan: string;
    tencongdoan: string | null;
    hehang: string | null;
    heso: number;
    ngaySet: Set<string>;
    tungay: string | null;
    denngay: string | null;
    sokhoi: number | null;
  }
  const stage2 = new Map<string, Stage2>();
  for (const b of stage1.values()) {
    const hesoRaw = b.hehang == null ? null : (hesoByTenhh.get(b.hehang) ?? null);
    const heso = hesoRaw ?? 1; // COALESCE(B.heso, 1)
    const key = [b.c_op, b.n_op, b.hehang, heso].map((v) => String(v)).join("\u0001");
    let g = stage2.get(key);
    if (!g) {
      g = {
        macongdoan: b.c_op,
        tencongdoan: b.n_op,
        hehang: b.hehang,
        heso,
        ngaySet: new Set<string>(),
        tungay: null,
        denngay: null,
        sokhoi: null,
      };
      stage2.set(key, g);
    }
    if (b.ngay != null) {
      g.ngaySet.add(b.ngay);
      if (g.tungay == null || b.ngay < g.tungay) g.tungay = b.ngay;
      if (g.denngay == null || b.ngay > g.denngay) g.denngay = b.ngay;
    }
    if (b.sokhoi != null) g.sokhoi = (g.sokhoi ?? 0) + b.sokhoi;
  }

  // Proc gốc không ORDER BY — sort nhẹ cho output ổn định
  return [...stage2.values()]
    .map((g) => ({
      macongdoan: g.macongdoan,
      tencongdoan: g.tencongdoan,
      madonhang: args.madonhang,
      hehang: g.hehang,
      heso: g.heso,
      songay: g.ngaySet.size,
      tungay: g.tungay,
      denngay: g.denngay,
      sokhoi: g.sokhoi,
      sokhoi1: g.sokhoi == null ? null : g.sokhoi * g.heso,
    }))
    .sort(
      (a, z) =>
        (a.macongdoan ?? "").localeCompare(z.macongdoan ?? "") ||
        (a.hehang ?? "").localeCompare(z.hehang ?? ""),
    );
}
