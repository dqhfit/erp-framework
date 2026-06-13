/* Port TR_MUCTIEU_SANXUAT2_TINHTOAN — tính toán mục tiêu sản xuất tháng cho
   1 bộ phận (nam, thang, mabophan). Nguồn:
   migration-plan/ui/proc-bodies/tr_muctieu_sanxuat2_tinhtoan.sql

   Proc gốc là chuỗi ~20 UPDATE tuần tự trên tr_muctieu_sanxuat2 (nhiều dòng
   theo mức thưởng `mucthuong`) + tr_muctieu_sanxuat2_chitiet (mỗi dòng 1
   ngày), kèm 1 CURSOR cộng dồn giờ chênh lệch. NHIỀU UPDATE lấy giá trị
   cột-từ-cột (vd col11 = col10*(col5/col4)) và phụ thuộc cột vừa set ở bước
   trước → procTable.updateWhere (chỉ nhận giá trị literal) KHÔNG diễn đạt
   trực tiếp được. Cách trung thực: ĐỌC toàn bộ dòng liên quan → TÍNH trong
   JS đúng THỨ TỰ proc (mutate object in-memory, bước sau đọc giá trị bước
   trước y như SQL commit từng UPDATE) → GHI lại từng dòng.

   Khác biệt có chủ đích so T-SQL:
   - Chia cho 0: T-SQL sẽ lỗi "divide by zero"; ở đây dùng div(a,b)=b?a/b:0
     (an toàn, khớp tinh thần các IIF(x=0,0,...) mà proc đã guard sẵn).
   - 2 biến chết trong proc (@tile_muctieu_khongtangca, @songuoi_trungbinh)
     + cursor đầu (đã comment) → bỏ.
   - Tham chiếu nghiệp vụ col*: [[project_muctieu_sanxuat_analysis]]
     (col18 'Đạt' = col17 >= col15; thưởng theo phantram_tang/mucthuong).

   Bảng đang mirror → procTable chặn ghi tới khi cutover (như mọi proc ghi). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
/** Chia an toàn: mẫu 0 → 0 (T-SQL gốc sẽ lỗi divide-by-zero). */
const div = (a: number, b: number): number => (b ? a / b : 0);

export async function trMuctieuSanxuat2Tinhtoan(
  db: DB,
  companyId: string,
  args: {
    nam: number;
    thang: number;
    mabophan: string;
  },
): Promise<{ updatedMuctieu: number; updatedChitiet: number }> {
  if (args.nam == null) throw new Error("Thiếu nam");
  if (args.thang == null) throw new Error("Thiếu thang");
  if (!args.mabophan) throw new Error("Thiếu mabophan");
  const { nam, thang, mabophan } = args;
  // ngaythang là cột date (text ISO 'YYYY-MM-DD') → lọc theo prefix tháng.
  const prefix = `${nam}-${String(thang).padStart(2, "0")}`;

  const m2 = await procTable(db, companyId, "tr_muctieu_sanxuat2");
  const ct = await procTable(db, companyId, "tr_muctieu_sanxuat2_chitiet");

  // ── Đọc dòng liên quan ──
  const mucRows = await m2.listWhere(
    sql`${m2.num("nam")} = ${nam} AND ${m2.num("thang")} = ${thang}
        AND ${m2.text("mabophan")} = ${mabophan}`,
  );
  const ctRows = await ct.listWhere(
    sql`${ct.text("macongdoan")} = ${mabophan}
        AND ${ct.text("ngaythang")} LIKE ${`${prefix}%`}`,
    { orderBy: sql`${ct.text("ngaythang")} ASC` },
  );
  if (mucRows.length === 0) return { updatedMuctieu: 0, updatedChitiet: 0 };

  // ── Scalar nhóm A: số ngày làm việc + tổng giờ mục tiêu (muctieu_sogio>0) ──
  const ctSogio = ctRows.filter((r) => n(r.muctieu_sogio) > 0);
  const songayLamviec = ctSogio.length;
  const muctieuTonggio = ctSogio.reduce((s, r) => s + n(r.muctieu_tonggio), 0);

  // ── Scalar nhóm B: từ dòng mức thưởng = 1 ──
  const rowMuc1 = mucRows.find((r) => n(r.mucthuong) === 1);
  const tileMuc1 = n(rowMuc1?.col6); // tỉ lệ mục tiêu mức 1 (giữ giá trị GỐC col6)

  // ── Scalar nhóm C: tổng giờ HC mục tiêu + tổng giờ thực tế (mọi dòng tháng) ──
  const sogioMuctieuKhongtangca = ctRows.reduce((s, r) => s + n(r.muctieu_tonggio_hc), 0);
  let tonggioThucte = ctRows.reduce((s, r) => s + n(r.tonggio), 0);

  const sokhoiMuctieu1Khongtangca = (tileMuc1 / 8) * sogioMuctieuKhongtangca;

  // ── Bước 5-9: cập nhật cột muctieu2 theo từng dòng (mucthuong/phantram_tang) ──
  for (const r of mucRows) {
    const mucthuong = n(r.mucthuong);
    const phantramTang = n(r.phantram_tang);
    const col2 = n(r.col2);
    r.songay = songayLamviec;
    r.col4 = sogioMuctieuKhongtangca;
    r.col10 = muctieuTonggio;
    r.col13 = tonggioThucte;
    r.col5 =
      mucthuong === 1
        ? sokhoiMuctieu1Khongtangca
        : sokhoiMuctieu1Khongtangca + (phantramTang * sokhoiMuctieu1Khongtangca) / 100;
    // Bước 6: col11 = col10 * (col5/col4)
    r.col11 = n(r.col10) * div(n(r.col5), n(r.col4));
    // Bước 7: col6 = mucthuong==1 ? col6(gốc) : col5/col4*8
    r.col6 = mucthuong === 1 ? n(r.col6) : div(n(r.col5), n(r.col4)) * 8;
    // Bước 8: col1 = (col5 - col2*10)/35
    r.col1 = (n(r.col5) - col2 * 10) / 35;
    // Bước 9: col3 = col1 + col2
    r.col3 = n(r.col1) + col2;
  }

  // ── Bước 11-13 (chitiet): số khối theo HC + số khối + tỉ lệ hoàn thành ──
  for (const r of ctRows) {
    r.muctieu_sokhoi_theo_hc = n(r.muctieu_tonggio_hc) * (tileMuc1 / 8);
    r.sokhoi = (tileMuc1 / 8) * n(r.tonggio); // ghi đè sokhoi (dùng lại ở bước 16)
    r.tile_hoanthanh = div(n(r.sokhoi_hoanthanh), n(r.tonggio)) * 8;
  }

  // ── Bước 14: tổng số khối tăng ca + tổng giờ mục tiêu (giá trị chitiet GỐC) ──
  const sumSokhoiTheoTangca = ctRows.reduce((s, r) => s + n(r.muctieu_sokhoi_theo_tangca), 0);
  const sumMuctieuTonggio = ctRows.reduce((s, r) => s + n(r.muctieu_tonggio), 0);

  // ── Bước 15 (chitiet): số khối trung bình theo công thức hiện diện ──
  for (const r of ctRows) {
    const hienDien =
      (r.day_names !== "Sun" ? n(r.muctieu_songuoi) * 8 : 0) +
      n(r.muctieu_songuoi_tangca_15) * n(r.muctieu_sogio_tangca_15) +
      n(r.muctieu_songuoi_tangca_20) * n(r.muctieu_sogio_tangca_20);
    r.muctieu_sokhoi_trungbinh = div(sumSokhoiTheoTangca, sumMuctieuTonggio) * hienDien;
  }

  // ── Bước 16: tổng giờ + tổng số khối thực tế (sokhoi ĐÃ cập nhật ở bước 12) ──
  tonggioThucte = ctRows.reduce((s, r) => s + n(r.tonggio), 0);
  const tongsokhoiThucte = ctRows.reduce((s, r) => s + n(r.sokhoi), 0);

  // ── Bước 17 (muctieu2): col7/col8/col9/col12/col14 ──
  for (const r of mucRows) {
    const col5 = n(r.col5);
    const col11 = n(r.col11);
    const part7 = col5 === 0 ? 0 : n(r.col1) * div(col11, col5);
    const part8 = col5 === 0 ? 0 : n(r.col2) * div(col11, col5);
    r.col7 = part7;
    r.col8 = part8;
    r.col9 = part7 + part8;
    r.col12 = div(col11, n(r.col10)) * 8;
    r.col14 =
      n(r.mucthuong) === 1
        ? tongsokhoiThucte
        : tongsokhoiThucte + (n(r.phantram_tang) * tongsokhoiThucte) / 100;
  }

  // ── Bước 18: tổng số khối hoàn thành + cont rời/ráp (chitiet GỐC) ──
  const sumSokhoiHoanthanh = ctRows.reduce((s, r) => s + n(r.sokhoi_hoanthanh), 0);
  const sumContRoi = ctRows.reduce((s, r) => s + n(r.cont_roi), 0);
  const sumContRap = ctRows.reduce((s, r) => s + n(r.cont_rap), 0);

  // ── Bước 19-21 (muctieu2): col15/col16/col22/col23 → col17 → col18 ──
  for (const r of mucRows) {
    r.col15 = div(n(r.col14), n(r.col13)) * 8;
    r.col16 = sumSokhoiHoanthanh + n(r.col24);
    r.col22 = sumContRoi;
    r.col23 = sumContRap;
    r.col17 = div(n(r.col16), n(r.col13)) * 8;
    r.col18 = n(r.col17) === 0 ? "" : n(r.col17) >= n(r.col15) ? "Đạt" : "";
  }

  // ── Bước 22-23: tổng số ngày hiện diện HC (>0) — chỉ tongngay_hc dùng tiếp ──
  const tongngayHc = ctRows.filter((r) => n(r.songuoi_hiendien_hc) > 0).length;

  // ── Bước 25 (muctieu2): col19 (số người TB) + col21 ──
  for (const r of mucRows) {
    const songuoiTb = tongngayHc === 0 ? 0 : div(n(r.col13), n(r.songay)) / 8;
    r.col19 = songuoiTb;
    r.col21 = n(r.col20) * songuoiTb;
  }

  // ── Bước 26 (cursor): cộng dồn giờ chênh lệch theo ngày, ghi vào dòng HC>0 ──
  let giocanbu = 0;
  for (const r of ctRows) {
    giocanbu += n(r.giochenhlech);
    if (n(r.songuoi_hiendien_hc) > 0) r._giocanbu = giocanbu;
  }

  // ── Ghi lại ──
  const M2_COLS = [
    "songay",
    "col1",
    "col3",
    "col4",
    "col5",
    "col6",
    "col7",
    "col8",
    "col9",
    "col10",
    "col11",
    "col12",
    "col13",
    "col14",
    "col15",
    "col16",
    "col17",
    "col18",
    "col19",
    "col21",
    "col22",
    "col23",
  ] as const;
  let updatedMuctieu = 0;
  for (const r of mucRows) {
    const patch: Record<string, unknown> = {};
    for (const c of M2_COLS) patch[c] = r[c];
    updatedMuctieu += await m2.updateWhere(patch, sql`id = ${String(r._id)}::uuid`);
  }

  let updatedChitiet = 0;
  for (const r of ctRows) {
    const patch: Record<string, unknown> = {
      muctieu_sokhoi_theo_hc: r.muctieu_sokhoi_theo_hc,
      sokhoi: r.sokhoi,
      tile_hoanthanh: r.tile_hoanthanh,
      muctieu_sokhoi_trungbinh: r.muctieu_sokhoi_trungbinh,
    };
    // giocanbu chỉ ghi cho dòng có người hiện diện HC (proc gốc).
    if (r._giocanbu !== undefined) patch.giocanbu = r._giocanbu;
    updatedChitiet += await ct.updateWhere(patch, sql`id = ${String(r._id)}::uuid`);
  }

  return { updatedMuctieu, updatedChitiet };
}
