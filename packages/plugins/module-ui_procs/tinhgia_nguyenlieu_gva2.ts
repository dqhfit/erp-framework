/* Port TINHGIA_NGUYENLIEU_GVA2 — tổng giá nguyên liệu gỗ ván (VND) +
   tổng khối tinh chế của 1 sản phẩm.
   Nguồn: migration-plan/ui/proc-bodies/tinhgia_nguyenlieu_gva2.sql
   Cursor trên tr_dinhmuc_govan (masp, nguyenlieu NOT IN ('','0')) →
   for-loop JS. Mỗi dòng:
     sokhoiTC = dayy_tc × rong_tc × dai_tc × soluong_tc / 1e9
     dongia/loaitien = FN_DONGIA_NGUYENLIEU_GVA4(nguyenlieu, dayy_tc, dai_tc)
     loaitien USD → dongia × tigia; cộng dồn dongia × sokhoiTC + sokhoiTC.
   Function bảng FN_DONGIA_NGUYENLIEU_GVA4 (nguồn:
   migration-plan/ui/proc-bodies/fn_dongia_nguyenlieu_gva4.sql) được PORT
   thành hàm JS nội bộ: nạp 1 lần các dòng tr_dongia_nguyenlieu_gva khớp
   (id_nguyenlieu HOẶC nguyenlieu) của mọi nguyên liệu xuất hiện, rồi tính
   theo 3 nhánh CASE của function — xem fnDongiaNguyenlieuGva4 bên dưới.
   Lưu ý NOT IN với NULL: nguyenlieu NULL bị loại ở cả T-SQL lẫn PG.
   2 OUTPUT param khởi tạo 0 → trả [{ tongdongia_vnd, tongkhoitinhche }]. */
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
  gianhap: number;
  loaitien: string;
}

/* Port FN_DONGIA_NGUYENLIEU_GVA4: chọn đơn giá theo độ dày + chiều dài.
   `all` = các dòng bảng giá đã lọc theo (id_nguyenlieu = key OR
   nguyenlieu = key). 3 nhánh CASE của function gốc (nhánh là điều kiện
   toàn cục, không phụ thuộc từng dòng):
   1. dai > MAX(dai_den) của các dòng cùng dayy → match dòng có dongia
      bằng "giá dòng dai_den lớn nhất cùng dayy" (gianhap nếu khác 0,
      ngược lại dongia). MAX trên tập rỗng = NULL → so sánh false →
      rơi xuống nhánh sau, đúng ngữ nghĩa T-SQL.
   2. tồn tại dòng cùng dayy có dai trong [dai_tu, dai_den) → match MỌI
      dòng có dai trong khoảng (function gốc KHÔNG lọc dayy ở điều kiện
      IsMatch — giữ nguyên).
   3. còn lại → match dòng có dongia bằng giá của dòng dongia cao nhất.
   TOP 1 cuối không ORDER BY → lấy dòng match đầu tiên. */
function fnDongiaNguyenlieuGva4(
  all: GiaRow[],
  dayy: number,
  dai: number,
): { dongia: number; loaitien: string } | null {
  if (all.length === 0) return null;
  const giaCua = (r: GiaRow): number => (r.gianhap === 0 ? r.dongia : r.gianhap);

  const cungDayy = all.filter((r) => r.dayy === dayy);
  const maxDaiDen = cungDayy.length > 0 ? Math.max(...cungDayy.map((r) => r.dai_den)) : null;

  let matched: GiaRow[];
  if (maxDaiDen != null && dai > maxDaiDen) {
    // TOP 1 ... cùng dayy ORDER BY dai_den DESC
    const top = [...cungDayy].sort((a, b) => b.dai_den - a.dai_den)[0];
    const target = top ? giaCua(top) : Number.NaN;
    matched = all.filter((r) => r.dongia === target);
  } else if (cungDayy.some((r) => dai >= r.dai_tu && dai < r.dai_den)) {
    matched = all.filter((r) => dai >= r.dai_tu && dai < r.dai_den);
  } else {
    // TOP 1 ... ORDER BY dongia DESC (mọi dòng, không lọc dayy)
    const top = [...all].sort((a, b) => b.dongia - a.dongia)[0];
    const target = top ? giaCua(top) : Number.NaN;
    matched = all.filter((r) => r.dongia === target);
  }
  const hit = matched[0];
  return hit ? { dongia: hit.dongia, loaitien: hit.loaitien } : null;
}

export async function tinhgiaNguyenlieuGva2(
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

  // Cursor gốc → đọc trọn danh sách dòng định mức rồi for-loop
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

  // Nạp bảng giá 1 lần cho mọi nguyên liệu xuất hiện (thay vì query
  // từng vòng cursor) — function gốc khớp id_nguyenlieu HOẶC nguyenlieu.
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
      gianhap: Number(r.gianhap ?? 0), // ISNULL(gianhap, 0)
      loaitien: r.loaitien == null ? "" : String(r.loaitien),
    }));
  }

  // T-SQL: SET @tongdongia_vnd = 0; SET @tongkhoitinhche = 0
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
    const gia = fnDongiaNguyenlieuGva4(cuaKey, dayyTc, daiTc);
    // Function không trả dòng nào → @dongia = 0, @loaitien = '' (giữ giá trị reset)
    let dongia = gia?.dongia ?? 0;
    if ((gia?.loaitien ?? "") === "USD") dongia = dongia * tigia;

    tongdongiaVnd += dongia * sokhoiTC;
    tongkhoitinhche += sokhoiTC;
  }

  return [{ tongdongia_vnd: tongdongiaVnd, tongkhoitinhche }];
}
