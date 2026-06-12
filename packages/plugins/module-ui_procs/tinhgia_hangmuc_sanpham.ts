/* Port TINHGIA_HANGMUC_SANPHAM — tính chi phí 1 hạng mục cho 1 sản phẩm.
   Trả 1 dòng scalar: id_hangmuc, chiphi1 (CP cho 1 SP), chiphi2 (CP cho
   1 khối), ghichu (diễn giải công thức).

   Khung thời gian: 6 tháng gần nhất — từ ngày đầu của tháng (hiện tại
   trừ 6 tháng) đến cuối tháng hiện tại (EOMONTH), tính theo UTC.
   T-SQL BETWEEN biến date với cột datetime tương đương khoảng
   [00:00 ngày đầu .. 00:00 ngày cuối] — giữ nguyên ngữ nghĩa.

   Aggregate nhiều bảng qua SQL thô + biểu thức procTable; join
   tr_thongke_soluong x tr_sanpham tách 2 derived table vì biểu thức
   procTable không mang alias (tránh nhập nhằng tên cột f_masp).

   Nhánh 10/22/24/25 phụ thuộc proc TINHGIA_NGUYENLIEU_GVA/SON/NKI/DGO
   (OUTPUT param) CHƯA PORT — fail-fast throw lỗi rõ thay vì trả số sai.
   Biến @tongsoluong_xuat ở proc gốc tính ra nhưng không dùng — bỏ.
   Nguồn: migration-plan/ui/proc-bodies/tinhgia_hangmuc_sanpham.sql */
import type { DB } from "@erp-framework/server/db";
import { sql, type SQL } from "drizzle-orm";
import { procTable, rows } from "../src/proc-table";
import { tinhgiaNguyenlieuDgo } from "./tinhgia_nguyenlieu_dgo";
import { tinhgiaNguyenlieuGva } from "./tinhgia_nguyenlieu_gva";
import { tinhgiaNguyenlieuNki } from "./tinhgia_nguyenlieu_nki";
import { tinhgiaNguyenlieuSon } from "./tinhgia_nguyenlieu_son";

/** FORMAT(x, '#,0.##') của T-SQL → ngăn cách hàng nghìn + tối đa N lẻ. */
const fmt = (v: number, maxFrac = 2): string =>
  v.toLocaleString("en-US", { maximumFractionDigits: maxFrac });

export async function tinhgiaHangmucSanpham(
  db: DB,
  companyId: string,
  args: { id_hangmuc: number; tigia?: number; masp: string },
): Promise<Array<{ id_hangmuc: number; chiphi1: number; chiphi2: number; ghichu: string }>> {
  if (args.id_hangmuc == null) throw new Error("Thiếu id_hangmuc");
  if (!args.masp) throw new Error("Thiếu masp");
  const id = args.id_hangmuc;
  const tigia = args.tigia ?? 25400; // T-SQL: @tigia float = 25400

  // Các nhánh 10/22/24/25 gọi proc TINHGIA_NGUYENLIEU_* — đã port,
  // wire trực tiếp trong chuỗi dispatch bên dưới (cần m3 tính trước).

  // Khung 6 tháng: DATEFROMPARTS(YEAR/MONTH của (now - 6 tháng), 1) .. EOMONTH(now)
  const now = new Date();
  const firstDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 6, 1))
    .toISOString()
    .slice(0, 10);
  const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
  const inRange = (expr: SQL): SQL =>
    sql`${expr} >= ${firstDay}::timestamptz AND ${expr} <= ${lastDay}::timestamptz`;

  const tNc = await procTable(db, companyId, "tr_chiphi_nhancong");

  // Tổng tiền lương + BHXH/công đoàn theo nhóm bộ phận trong khung 6 tháng
  const sumNhancong = async (bophans: string[]): Promise<{ tienluong: number; bhxh: number }> => {
    const res = await db.execute(sql`
      SELECT SUM(${tNc.num("tienluong")}) AS tienluong,
             SUM(${tNc.num("bhxh_congdoan")}) AS bhxh
      FROM ${tNc.tbl}
      WHERE ${tNc.scope}
        AND ${tNc.text("bophan")} IN (${sql.join(
          bophans.map((b) => sql`${b}`),
          sql`, `,
        )})
        AND ${inRange(tNc.ts("ngaythang"))}
    `);
    const [r] = rows<{ tienluong: unknown; bhxh: unknown }>(res);
    return { tienluong: Number(r?.tienluong ?? 0), bhxh: Number(r?.bhxh ?? 0) };
  };

  // CP "khác" (Bảo trì + QC + THỜI VỤ) chia 3 — phân bổ đều cho 3 cụm
  // phôi / định hình / sơn+đóng gói; lương tháng 13 khác = (lương/3)/12
  const khac = await sumNhancong(["Bảo trì", "QC", "THỜI VỤ"]);
  const tienluongKhac = khac.tienluong / 3;
  const bhxhKhac = khac.bhxh / 3;
  const luong13Khac = tienluongKhac / 12;

  // Tổng số khối hoàn thành đồng bộ phôi (DP09-PROD) + định hình 1 (DH06-PROD)
  const tTt = await procTable(db, companyId, "tr_trangthai_sanxuat");
  const ttRes = await db.execute(sql`
    SELECT
      SUM(CASE WHEN ${tTt.text("congdoan")} = 'DP09-PROD' THEN ${tTt.num("sokhoi")} END) AS dp,
      SUM(CASE WHEN ${tTt.text("congdoan")} = 'DH06-PROD' THEN ${tTt.num("sokhoi")} END) AS dh
    FROM ${tTt.tbl}
    WHERE ${tTt.scope}
      AND ${tTt.text("congdoan")} IN ('DP09-PROD', 'DH06-PROD')
      AND ${inRange(tTt.ts("ngaythang"))}
  `);
  const [tt] = rows<{ dp: unknown; dh: unknown }>(ttRes);
  const khoiDp = Number(tt?.dp ?? 0); // @tongsokhoi_hoanthanh_dp
  const khoiDh = Number(tt?.dh ?? 0); // @tongsokhoi_hoanthanh_dh

  // Số khối sơn lên chuyền (SON+DGO) + số khối xuất/đóng gói (DGO):
  // SUM(soluong * m3_tc) join tr_thongke_soluong x tr_sanpham theo masp
  const tTk = await procTable(db, companyId, "tr_thongke_soluong");
  const tSp = await procTable(db, companyId, "tr_sanpham");
  const tkRes = await db.execute(sql`
    SELECT
      SUM(a.soluong * b.m3_tc) AS khoi_tp,
      SUM(CASE WHEN a.bophan = 'DGO' THEN a.soluong * b.m3_tc END) AS khoi_xuat
    FROM (
      SELECT ${tTk.text("masp")} AS masp, ${tTk.text("bophan")} AS bophan,
             ${tTk.num("soluong")} AS soluong
      FROM ${tTk.tbl}
      WHERE ${tTk.scope}
        AND ${tTk.text("bophan")} IN ('SON', 'DGO')
        AND ${inRange(tTk.ts("ngaynhap"))}
    ) a
    JOIN (
      SELECT ${tSp.text("masp")} AS masp, ${tSp.num("m3_tc")} AS m3_tc
      FROM ${tSp.tbl}
      WHERE ${tSp.scope}
    ) b ON a.masp = b.masp
  `);
  const [tk] = rows<{ khoi_tp: unknown; khoi_xuat: unknown }>(tkRes);
  const khoiTp = Number(tk?.khoi_tp ?? 0); // @tongsokhoi_hoanthanh_tp
  const khoiXuat = Number(tk?.khoi_xuat ?? 0); // @tongsokhoi_xuat

  // m3_tc + đơn giá bán của sản phẩm (NULL → 0, proc gốc cũng ép m3 về 0)
  const [sp] = await tSp.listWhere(sql`${tSp.text("masp")} = ${args.masp}`, { limit: 1 });
  const m3 = Number(sp?.m3_tc ?? 0);
  const dongiaSp = Number(sp?.dongia ?? 0);

  // giatri của chính hạng mục (nhánh 4/21/23/else)
  const giatriHangmuc = async (): Promise<number> => {
    const tHm = await procTable(db, companyId, "tr_hangmuc_chiphi");
    const [hm] = await tHm.listWhere(sql`${tHm.num("id")} = ${id}`, { limit: 1 });
    return Number(hm?.giatri ?? 0);
  };

  // SUM 1 cột chi phí khấu hao trong khung (nhánh 15/16/17)
  const sumKhauhao = async (field: string): Promise<number> => {
    const tKh = await procTable(db, companyId, "tr_chiphi_khauhao");
    const res = await db.execute(sql`
      SELECT SUM(${tKh.num(field)}) AS total
      FROM ${tKh.tbl}
      WHERE ${tKh.scope} AND ${inRange(tKh.ts("ngaythang"))}
    `);
    const [r] = rows<{ total: unknown }>(res);
    return Number(r?.total ?? 0);
  };

  let chiphi1 = 0;
  let chiphi2 = 0;
  let ghichu = "";

  if (id === 4) {
    // Phí nhập khẩu, xuất khẩu
    const phixuatcont = await giatriHangmuc();
    chiphi2 = phixuatcont / 68;
    chiphi2 = chiphi2 + chiphi2 * 0.12;
    chiphi1 = chiphi2 * m3;
    ghichu = `CP 1 SP = ([CP xuất cont 1 khối(${fmt(chiphi2)})] + 12%) x [Số khối TC (${fmt(m3, 4)})]`;
  } else if (id === 5) {
    // Phí quản lý công ty = 2% giá bán
    chiphi1 = dongiaSp * tigia * 0.02;
    chiphi2 = m3 === 0 ? 0 : chiphi1 / m3;
    ghichu = "CP 1 SP = [Giá bán] x 2%";
  } else if (id === 6) {
    // Phí quản lý xưởng = 5% chi phí nhân công (mọi bộ phận)
    const res = await db.execute(sql`
      SELECT SUM(${tNc.num("tienluong")} + ${tNc.num("bhxh_congdoan")} + ${tNc.num("luongthang_13")}) AS total
      FROM ${tNc.tbl}
      WHERE ${tNc.scope} AND ${inRange(tNc.ts("ngaythang"))}
    `);
    const [r] = rows<{ total: unknown }>(res);
    const chiphinhancong = Number(r?.total ?? 0);
    chiphi2 = (khoiXuat === 0 ? 0 : chiphinhancong / khoiXuat) * 0.05;
    chiphi1 = chiphi2 * m3;
    ghichu = `CP 1 SP = ([Tổng chi phí nhân công 6 tháng] / [Tổng khối TC 6 tháng đã xuất (${fmt(khoiXuat, 4)})]) * 5% * [Số khối TC 1 SP]`;
  } else if (id === 7) {
    // Hoa hồng = 2% giá bán
    chiphi1 = dongiaSp * tigia * 0.02;
    chiphi2 = m3 === 0 ? 0 : chiphi1 / m3;
    ghichu = "CP 1 SP = [Giá bán] x 2%";
  } else if (id === 8) {
    // Phí claim = 1.5% giá bán
    chiphi1 = dongiaSp * tigia * 0.015;
    chiphi2 = m3 === 0 ? 0 : chiphi1 / m3;
    ghichu = "CP 1 SP = [Giá bán] x 1.5%";
  } else if (id === 9) {
    // Phí khác = 1% giá bán
    chiphi1 = dongiaSp * tigia * 0.01;
    chiphi2 = m3 === 0 ? 0 : chiphi1 / m3;
    ghichu = "CP 1 SP = [Giá bán] x 1%";
  } else if (id === 10) {
    // GỖ VÁN — EXEC TINHGIA_NGUYENLIEU_GVA @masp, @tigia, 2 OUTPUT
    const [gva] = await tinhgiaNguyenlieuGva(db, companyId, { masp: args.masp, tigia });
    chiphi1 = gva?.tongdongia_vnd ?? 0;
    const khoi = gva?.tongkhoitinhche ?? 0;
    chiphi2 = khoi === 0 ? 0 : chiphi1 / khoi; // IIF(@tongkhoitinhche = 0, 0, ...)
    ghichu =
      "CP 1 SP = SUM([Số khối NL theo định mức] * [Đơn giá nguyên liệu]); [Đơn giá NL] lấy theo chi phí nguyên liệu trong báo giá hoàn thiện";
  } else if (id === 22) {
    // CHI PHÍ SƠN — EXEC TINHGIA_NGUYENLIEU_SON (OUT1 = tổng theo sản phẩm)
    const [son] = await tinhgiaNguyenlieuSon(db, companyId, { masp: args.masp, tigia });
    chiphi1 = son?.tongdongia_sanpham ?? 0;
    // Proc gốc: chỉ set chiphi2 khi @m3_tc > 0 (không có ELSE — giữ 0)
    if (m3 > 0) chiphi2 = chiphi1 / m3;
    // Giữ nguyên chuỗi gốc kể cả thiếu ngoặc đóng
    ghichu = "CP 1 SP = ([Đơn giá 1 khối] * [Số khối TC 1 SP]";
  } else if (id === 24) {
    // NGŨ KIM — EXEC TINHGIA_NGUYENLIEU_NKI (OUTPUT tongdonagia_vnd — typo gốc)
    const [nki] = await tinhgiaNguyenlieuNki(db, companyId, { masp: args.masp, tigia });
    chiphi1 = nki?.tongdonagia_vnd ?? 0;
    chiphi2 = m3 === 0 ? 0 : chiphi1 / m3; // IIF(@m3_tc = 0, 0, ...)
    ghichu = "CP 1 SP = [Số lượng theo định mức] * [Đơn giá vật tư]";
  } else if (id === 25) {
    // ĐÓNG GÓI — EXEC TINHGIA_NGUYENLIEU_DGO
    const [dgo] = await tinhgiaNguyenlieuDgo(db, companyId, { masp: args.masp, tigia });
    chiphi1 = dgo?.tongdonagia_vnd ?? 0;
    chiphi2 = m3 === 0 ? 0 : chiphi1 / m3;
    ghichu = "CP 1 SP = [Số lượng theo định mức] * [Đơn giá vật tư]";
  } else if (id === 15) {
    // Khấu hao máy móc, nhà xưởng
    const maymoc = await sumKhauhao("maymoc_nhaxuong");
    chiphi2 = khoiXuat === 0 ? 0 : maymoc / khoiXuat;
    chiphi1 = chiphi2 * m3;
    ghichu = `CP 1 SP = ([Tổng chi phí 6 tháng (${fmt(maymoc, 0)})] / [Tổng số khối TC xuất trong 6 tháng (${fmt(khoiXuat, 4)})]) * [Số khối TC 1 SP]`;
  } else if (id === 16) {
    // CCDC, sửa chữa
    const suachua = await sumKhauhao("suachua");
    chiphi2 = khoiXuat === 0 ? 0 : suachua / khoiXuat;
    chiphi1 = chiphi2 * m3;
    ghichu = `CP 1 SP = ([Tổng chi phí 6 tháng (${fmt(suachua, 0)})] / [Tổng số khối TC xuất trong 6 tháng (${fmt(khoiXuat, 4)})]) * [Số khối TC 1 SP]`;
  } else if (id === 17) {
    // Bảo hiểm tài sản
    const baohiem = await sumKhauhao("baohiem_taisan");
    chiphi2 = khoiXuat === 0 ? 0 : baohiem / khoiXuat;
    chiphi1 = chiphi2 * m3;
    ghichu = `CP 1 SP = ([Tổng chi phí 6 tháng (${fmt(baohiem, 0)})] / [Tổng số khối TC xuất trong 6 tháng (${fmt(khoiXuat, 4)})]) * [Số khối TC 1 SP]`;
  } else if (id === 18) {
    // Khấu hao nhân công phôi - tiền lương
    const dp = await sumNhancong(["Phôi"]);
    chiphi2 = khoiDp === 0 ? 0 : (dp.tienluong + tienluongKhac) / khoiDp;
    chiphi1 = chiphi2 * m3;
    ghichu =
      "CP 1 SP = ([Tổng chi phí Phôi 6 tháng] / [Tổng số khối hoàn thành đồng bộ phôi trong 6 tháng]) * [Số khối TC 1 SP]";
  } else if (id === 19) {
    // Khấu hao nhân công phôi - BHXH + Công đoàn
    const dp = await sumNhancong(["Phôi"]);
    chiphi2 = khoiDp === 0 ? 0 : (dp.bhxh + bhxhKhac) / khoiDp;
    chiphi1 = chiphi2 * m3;
    ghichu =
      "CP 1 SP = ([Tổng chi phí Phôi 6 tháng] / [Tổng số khối hoàn thành đồng bộ phôi trong 6 tháng]) * [Số khối TC 1 SP]";
  } else if (id === 20) {
    // Khấu hao nhân công phôi - lương tháng 13 = 1/12 tiền lương
    const dp = await sumNhancong(["Phôi"]);
    chiphi2 = khoiDp === 0 ? 0 : (dp.tienluong / 12 + luong13Khac) / khoiDp;
    chiphi1 = chiphi2 * m3;
    ghichu = "1/12 tiền lương";
  } else if (id === 33) {
    // Khấu hao nhân công định hình - tiền lương
    const dh = await sumNhancong(["Định hình"]);
    chiphi2 = khoiDh === 0 ? 0 : (dh.tienluong + tienluongKhac) / khoiDh;
    chiphi1 = chiphi2 * m3;
    ghichu =
      "CP 1 SP = ([Tổng chi phí định hình 6 tháng] / [Tổng số khối hoàn thành đồng bộ định hình 1 trong 6 tháng]) * [Số khối TC 1 SP]";
  } else if (id === 34) {
    // Khấu hao nhân công định hình - BHXH + Công đoàn
    const dh = await sumNhancong(["Định hình"]);
    chiphi2 = khoiDh === 0 ? 0 : (dh.bhxh + bhxhKhac) / khoiDh;
    chiphi1 = chiphi2 * m3;
    ghichu =
      "CP 1 SP = ([Tổng chi phí định hình 6 tháng] / [Tổng số khối hoàn thành đồng bộ định hình 1 trong 6 tháng]) * [Số khối TC 1 SP]";
  } else if (id === 35) {
    // Khấu hao nhân công định hình - lương tháng 13 = 1/12 tiền lương
    const dh = await sumNhancong(["Định hình"]);
    chiphi2 = khoiDh === 0 ? 0 : (dh.tienluong / 12 + luong13Khac) / khoiDh;
    chiphi1 = chiphi2 * m3;
    ghichu = "1/12 tiền lương";
  } else if (id === 37) {
    // Khấu hao nhân công sơn + đóng gói - tiền lương
    const tp = await sumNhancong(["Sơn", "Thành phẩm"]);
    chiphi2 = khoiTp === 0 ? 0 : (tp.tienluong + tienluongKhac) / khoiTp;
    chiphi1 = chiphi2 * m3;
    ghichu =
      "CP 1 SP = ([Tổng chi phí Sơn+đóng gói 6 tháng] / [Tổng số khối SP Sơn + Đóng gói trong 6 tháng]) * [Số khối TC 1 SP]";
  } else if (id === 38) {
    // Khấu hao nhân công sơn + đóng gói - BHXH + Công đoàn
    const tp = await sumNhancong(["Sơn", "Thành phẩm"]);
    chiphi2 = khoiTp === 0 ? 0 : (tp.bhxh + bhxhKhac) / khoiTp;
    chiphi1 = chiphi2 * m3;
    ghichu =
      "CP 1 SP = ([Tổng chi phí Sơn + đóng gói 6 tháng] / [Tổng số khối SP Sơn + đóng gói trong 6 tháng]) * [Số khối TC 1 SP]";
  } else if (id === 39) {
    // Khấu hao nhân công sơn + đóng gói - lương tháng 13 = 1/12 tiền lương
    const tp = await sumNhancong(["Sơn", "Thành phẩm"]);
    chiphi2 = khoiTp === 0 ? 0 : (tp.tienluong / 12 + luong13Khac) / khoiTp;
    chiphi1 = chiphi2 * m3;
    ghichu = "1/12 tiền lương";
  } else if (id === 40) {
    // Thuê xưởng: hằng số 1.05 tỷ / trung bình khối (phôi + ĐH1 + sơn) 1 tháng
    const thuexuong = 1050000000;
    const trungbinh = (khoiDp + khoiDh + khoiTp) / 6;
    chiphi2 = trungbinh === 0 ? 0 : thuexuong / trungbinh;
    chiphi1 = chiphi2 * m3;
    ghichu =
      "CP 1 SP = [chi phí thuê xưởng 1 tháng] / [trung bình số khối phôi, định hình 1, sơn của 1 tháng (lấy 6 tháng gần nhất)]";
  } else if (id === 21 || id === 23) {
    // 21: Keo ghép, keo lắp ráp; 23: Keo 502, vải lau, nhám — đơn giá 1 khối
    const dongia = await giatriHangmuc();
    chiphi1 = dongia * m3;
    chiphi2 = dongia;
    // Giữ nguyên chuỗi diễn giải gốc (kể cả thiếu ngoặc đóng)
    ghichu = "CP 1 SP = ([Đơn giá 1 khối] * [Số khối TC 1 SP]";
  } else {
    // Hạng mục còn lại: đơn giá 1 khối lấy từ tr_hangmuc_chiphi
    const dongia = await giatriHangmuc();
    chiphi1 = dongia * m3;
    chiphi2 = dongia;
    ghichu = "CP 1 SP = [Đơn giá 1 khối] * [Số khối TC 1 SP]";
  }

  return [{ id_hangmuc: id, chiphi1, chiphi2, ghichu }];
}
