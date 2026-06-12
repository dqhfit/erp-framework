/* Port TINHGIA_DONGGOI_BY_MAVT — tính đơn giá vật tư đóng gói theo mã vật tư.
   Nguồn: migration-plan/ui/proc-bodies/tinhgia_donggoi_by_mavt.sql
   Luồng gốc:
     1. Lấy seq10 + seg8 của vật tư từ tr_material.
     2. fn_Split(seq10, ',') → danh sách id chi tiết phân loại; cursor
        trmaterialclassstddtail JOIN trmaterialclassstd đọc (id, value)
        → for-loop JS gán kích thước (dai/rong/cao/dinhluong/phi/...)
        theo id tiêu chuẩn; fn_Split → String.split + trim.
     3. Theo seg8 tra đơn giá ở tr_congthuc_donggoi rồi áp công thức
        (xốp tấm/xốp L/xốp tam giác/thùng A1/A5/âm dương/CCT015).
   CHÚ Ý: bảng tr_congthuc_donggoi CHƯA migrate (PK ghép — nằm trong
   noSinglePk của import-items.json) → procTable sẽ fail-fast
   "entity không tồn tại" khi chạy tới nhánh cần bảng này. Vẫn port đầy
   đủ để dùng được ngay khi bảng được import; tên field lấy theo cột
   nguồn: nhom_chitiet, dinhluong, dongia, qc_phi, qc_dayy, mancc.
   Quy ước NULL: biến kích thước dùng NaN làm marker NULL (NaN lan
   truyền qua phép nhân như NULL; so sánh với NaN = false như UNKNOWN).
   @dongia_vattu là int OUT không khởi tạo → seg8 không khớp nhánh nào
   hoặc công thức ra NULL → trả null; T-SQL gán float vào int = TRUNCATE
   → Math.trunc ở bước cuối. dbo.fn_getNumber xấp xỉ bằng "lấy cụm số
   đầu tiên trong chuỗi" (kể cả phần thập phân). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable, rows } from "../src/proc-table";

/** Xấp xỉ dbo.fn_getNumber: cụm số đầu tiên (có thể có phần thập phân). */
function getNumber(s: string): string {
  const m = s.match(/\d+(?:\.\d+)?/);
  return m ? m[0] : "";
}

/** Tách "chính(phụ)" của nhánh CEP002: trước ngoặc = chính, trong ngoặc = phụ
 *  (không có cặp ngoặc → phụ = 0, chính = cả chuỗi — như CAST của T-SQL). */
function parseParen(s: string): { chinh: number; phu: number } {
  const li = s.indexOf("(");
  const ri = s.indexOf(")");
  const chinh = Number(li > -1 ? s.slice(0, li) : s);
  const phu = li > -1 && ri > -1 ? Number(s.slice(li + 1, ri)) : 0;
  return { chinh, phu };
}

export async function tinhgiaDonggoiByMavt(
  db: DB,
  companyId: string,
  args: {
    mavt: string;
    mancc?: string | null;
  },
): Promise<Array<{ dongia_vattu: number | null }>> {
  if (!args.mavt) throw new Error("Thiếu mavt");

  // T-SQL: @mancc nvarchar(500) = NULL
  const mancc = args.mancc ?? null;

  // Bước 1: seq10 + seg8 của vật tư
  const m = await procTable(db, companyId, "tr_material");
  const [mat] = await m.listWhere(sql`${m.text("mavt")} = ${args.mavt}`, { limit: 1 });
  const seq10 = mat?.seq10 == null ? "" : String(mat.seq10);
  const seg8 = mat?.seg8 == null ? "" : String(mat.seg8);

  // Bước 2: fn_Split(seq10, ',') → id chi tiết; phần tử không phải số bị
  // bỏ (T-SQL sẽ lỗi convert — ở đây lọc an toàn)
  const ids = seq10
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map(Number)
    .filter((n) => Number.isFinite(n));

  // Cursor: dtail b JOIN std a ON a.id = b.idstd WHERE b.id IN (ids)
  // → tách 2 query + ghép JS; @id của loop chính là b.idstd (= a.id)
  let chitiet: Array<{ id: number; giatri: string }> = [];
  if (ids.length > 0) {
    const td = await procTable(db, companyId, "trmaterialclassstddtail");
    const dtails = await td.listWhere(sql`
      ${td.num("id")} IN (${sql.join(
        ids.map((v) => sql`${v}`),
        sql`, `,
      )})
    `);
    const idstds = [
      ...new Set(dtails.map((d) => Number(d.idstd)).filter((n) => Number.isFinite(n))),
    ];
    const stdIds = new Set<number>();
    if (idstds.length > 0) {
      const tstd = await procTable(db, companyId, "trmaterialclassstd");
      const stds = await tstd.listWhere(sql`
        ${tstd.num("id")} IN (${sql.join(
          idstds.map((v) => sql`${v}`),
          sql`, `,
        )})
      `);
      for (const s of stds) stdIds.add(Number(s.id));
    }
    // INNER JOIN: chỉ giữ dtail có std tương ứng
    chitiet = dtails
      .filter((d) => stdIds.has(Number(d.idstd)))
      .map((d) => ({ id: Number(d.idstd), giatri: d.value == null ? "" : String(d.value) }));
  }

  // Bước 3: gán kích thước theo id tiêu chuẩn (NaN = NULL)
  let dai = 0;
  let rong = 0;
  let cao = 0;
  let rong1 = 0;
  let cao1 = 0;
  let dinhluong = 0;
  let dobuc = 0;
  let solop = 0;
  let phi = Number.NaN; // @phi float không khởi tạo → NULL

  for (const ct of chitiet) {
    const { id, giatri } = ct;
    if (seg8 === "CEP002") {
      // CAST(fn_getNumber(...) AS float): chuỗi rỗng → 0 như T-SQL
      const so = (s: string): number => (getNumber(s) === "" ? 0 : Number(getNumber(s)));
      if (id === 22) dinhluong = so(giatri);
      if (id === 4) dai = so(giatri);
      if (id === 3) {
        const p = parseParen(giatri);
        rong = p.chinh;
        rong1 = p.phu;
      }
      if (id === 9) {
        const p = parseParen(giatri);
        cao = p.chinh;
        cao1 = p.phu;
      }
    } else if (id === 17) {
      // fn_Split(giatri, '*') → dai/rong/cao theo vị trí 1..3;
      // phần tử thiếu hoặc không phải số → NULL (NaN) như MIN(CASE...)
      const parts = giatri.split("*").map((s) => s.trim());
      const taiViTri = (idx: number): number => {
        const v = parts[idx];
        const n = v == null || v === "" ? Number.NaN : Number(v);
        return Number.isFinite(n) ? n : Number.NaN;
      };
      dai = taiViTri(0);
      rong = taiViTri(1);
      cao = taiViTri(2);
    } else {
      const numStr = getNumber(giatri);
      const n = numStr === "" ? Number.NaN : Number(numStr);
      if (Number.isFinite(n)) {
        // ISNUMERIC = 1 mới gán
        if (id === 3) rong = n;
        if (id === 4) dai = n;
        if (id === 5) dinhluong = n;
        if (id === 9) cao = n;
        if (id === 14) phi = n;
        if (id === 18) dobuc = n;
        if (id === 19) solop = n;
        if (id === 22) dinhluong = n;
      }
    }
  }
  // @dobuc/@solop được gán nhưng proc gốc không dùng trong công thức —
  // giữ lại cho khớp nguồn, tránh cảnh báo unused bằng void.
  void dobuc;
  void solop;

  // Bước 4: tra đơn giá tr_congthuc_donggoi + áp công thức theo seg8.
  // procTable gọi lười TRONG nhánh — seg8 không khớp thì không đụng bảng
  // chưa migrate. SELECT @dongia = ... không có dòng → giữ 0.
  const giaTheoDinhluong = async (): Promise<number> => {
    const tc = await procTable(db, companyId, "tr_congthuc_donggoi");
    if (!Number.isFinite(dinhluong)) return 0; // dinhluong NULL → không khớp dòng nào
    const res = await db.execute(sql`
      SELECT ${tc.num("dongia")} AS dongia
      FROM ${tc.tbl}
      WHERE ${tc.scope}
        AND ${tc.text("nhom_chitiet")} = ${seg8}
        AND ${tc.num("dinhluong")} = ${dinhluong}
      LIMIT 1
    `);
    return Number(rows<{ dongia: unknown }>(res)[0]?.dongia ?? 0);
  };
  const giaTheoNhom = async (): Promise<number> => {
    const tc = await procTable(db, companyId, "tr_congthuc_donggoi");
    const res = await db.execute(sql`
      SELECT ${tc.num("dongia")} AS dongia
      FROM ${tc.tbl}
      WHERE ${tc.scope} AND ${tc.text("nhom_chitiet")} = ${seg8}
      LIMIT 1
    `);
    return Number(rows<{ dongia: unknown }>(res)[0]?.dongia ?? 0);
  };

  let dongiaVattu = Number.NaN; // @dongia_vattu int OUT — chưa gán = NULL

  if (seg8 === "CEP001") {
    // XỐP TẤM
    const dongia = await giaTheoDinhluong();
    dongiaVattu = ((dai * rong * cao) / 1_000_000_000) * dongia;
  } else if (seg8 === "CEP002") {
    // XỐP L
    const dongia = await giaTheoDinhluong();
    dongiaVattu = ((dai * (rong * rong1 + (cao - rong1) * cao1)) / 1_000_000_000) * dongia;
  } else if (seg8 === "CEP005") {
    // XỐP TAM GIÁC
    const dongia = await giaTheoDinhluong();
    dongiaVattu = (((dai * rong * cao) / 1_000_000_000) * dongia) / 2;
  } else if (seg8 === "CCT003") {
    // THÙNG A1
    const dongia = await giaTheoNhom();
    const chuvi = (dai + rong) * 2;
    // chuvi NaN < 2500 = false → nhánh else, đúng ngữ nghĩa NULL T-SQL
    const metvuong =
      chuvi < 2500
        ? ((dai * 2 + rong * 2 + 40) * (rong + cao + 20)) / 1_000_000
        : ((dai * 2 + rong * 2 + 80) * (rong + cao + 20)) / 1_000_000;
    dongiaVattu = dongia * metvuong;
  } else if (seg8 === "CCT007") {
    // THÙNG A5
    const dongia = await giaTheoNhom();
    const chuvi = (dai + rong) * 2;
    const metvuong =
      chuvi < 2500
        ? ((2 * rong + 2 * cao + 40) * (dai + 2 * cao + 20)) / 1_000_000
        : ((2 * rong + 2 * cao + 80) * (dai + 2 * cao + 20)) / 1_000_000;
    dongiaVattu = dongia * metvuong;
  } else if (seg8 === "CCT008" || seg8 === "CCT010" || seg8 === "CCT011") {
    // THÙNG ÂM DƯƠNG
    const dongia = await giaTheoNhom();
    const metvuong = ((dai + 2 * cao + 20) * (rong + 2 * cao + 20)) / 1_000_000;
    dongiaVattu = dongia * metvuong;
  } else if (seg8 === "CCT015") {
    const tc = await procTable(db, companyId, "tr_congthuc_donggoi");
    let dongia = 0;
    // qc_phi >= @phi với @phi NULL → không dòng nào khớp (cả 2 query)
    if (Number.isFinite(phi) && Number.isFinite(cao)) {
      if (mancc != null) {
        const res = await db.execute(sql`
          SELECT ${tc.num("dongia")} AS dongia
          FROM ${tc.tbl}
          WHERE ${tc.scope}
            AND ${tc.text("nhom_chitiet")} = ${seg8}
            AND ${tc.num("qc_phi")} >= ${phi}
            AND ${tc.num("qc_dayy")} >= ${cao}
            AND ${tc.text("mancc")} = ${mancc}
          ORDER BY ${tc.num("qc_phi")}, ${tc.num("qc_dayy")}
          LIMIT 1
        `);
        dongia = Number(rows<{ dongia: unknown }>(res)[0]?.dongia ?? 0);
      }
      if (dongia === 0) {
        const res = await db.execute(sql`
          SELECT ${tc.num("dongia")} AS dongia
          FROM ${tc.tbl}
          WHERE ${tc.scope}
            AND ${tc.text("nhom_chitiet")} = ${seg8}
            AND ${tc.num("qc_phi")} >= ${phi}
            AND ${tc.num("qc_dayy")} >= ${cao}
          ORDER BY ${tc.num("qc_phi")}, ${tc.num("qc_dayy")}, ${tc.num("dongia")}
          LIMIT 1
        `);
        dongia = Number(rows<{ dongia: unknown }>(res)[0]?.dongia ?? 0);
      }
    }
    const metvuong = (dai * rong) / 1_000_000;
    dongiaVattu = Math.round(dongia * metvuong); // ROUND(..., 0)
  }

  // Gán float vào int của T-SQL = truncate; NaN (NULL) → null
  return [{ dongia_vattu: Number.isFinite(dongiaVattu) ? Math.trunc(dongiaVattu) : null }];
}
