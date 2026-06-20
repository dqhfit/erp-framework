import { sql } from "drizzle-orm";
import {
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./tenant";

/* ─── MES: Mục tiêu sản xuất (port DQHF) ──────────────────── */

/** v1 — mục tiêu đơn giản theo ngày / đơn hàng / công đoạn. */
export const mesMucTieuSanXuat = pgTable(
  "mes_muctieu_sanxuat",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    ngaythang: date("ngaythang", { mode: "date" }).notNull(),
    maCongDoan: text("ma_cong_doan").notNull(),
    donHang: text("don_hang").notNull().default(""),
    heHang: text("he_hang").notNull().default(""),
    mucTieu: doublePrecision("muc_tieu").notNull().default(0),
    soNguoi: integer("so_nguoi").notNull().default(0),
    soGio: doublePrecision("so_gio").notNull().default(8),
    nguoiTao: text("nguoi_tao").notNull().default(""),
    ngayTao: timestamp("ngay_tao").defaultNow().notNull(),
    nguoiSua: text("nguoi_sua").notNull().default(""),
    ngaySua: timestamp("ngay_sua").defaultNow().notNull(),
  },
  (t) => ({
    ngayIdx: index("mes_muctieu_sanxuat_company_ngay_idx").on(
      t.companyId,
      t.maCongDoan,
      t.ngaythang,
    ),
  }),
);

/** v2 header — tổng hợp tháng theo mức thưởng (1–4). 25 cột tính toán bởi tinhtoan(). */
export const mesMucTieuSanXuatThang = pgTable(
  "mes_muctieu_sanxuat_thang",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    nam: integer("nam").notNull(),
    thang: integer("thang").notNull(),
    maBoPhan: text("ma_bo_phan").notNull(),
    mucThuong: integer("muc_thuong").notNull().default(1),
    soNguoi: integer("so_nguoi").notNull().default(0),
    soNgay: doublePrecision("so_ngay").notNull().default(0),
    phantramTang: doublePrecision("phantram_tang"),
    col1: doublePrecision("col1"),
    col2: doublePrecision("col2"),
    col3: doublePrecision("col3"),
    col4: doublePrecision("col4"),
    col5: doublePrecision("col5"),
    col6: doublePrecision("col6"),
    col7: doublePrecision("col7"),
    col8: doublePrecision("col8"),
    col9: doublePrecision("col9"),
    col10: doublePrecision("col10"),
    col11: doublePrecision("col11"),
    col12: doublePrecision("col12"),
    col13: doublePrecision("col13"),
    col14: doublePrecision("col14"),
    col15: doublePrecision("col15"),
    col16: doublePrecision("col16"),
    col17: doublePrecision("col17"),
    col18: text("col18"),
    col19: doublePrecision("col19"),
    col20: doublePrecision("col20"),
    col21: doublePrecision("col21"),
    col22: doublePrecision("col22"),
    col23: doublePrecision("col23"),
    col24: doublePrecision("col24"),
    col25: doublePrecision("col25"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    uk: uniqueIndex("mes_muctieu_sanxuat_thang_uk").on(
      t.companyId,
      t.nam,
      t.thang,
      t.maBoPhan,
      t.mucThuong,
    ),
  }),
);

/** v2 chi tiết — từng ngày trong tháng cho 1 bộ phận. */
export const mesMucTieuSanXuatChitiet = pgTable(
  "mes_muctieu_sanxuat_chitiet",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    maCongDoan: text("ma_cong_doan").notNull(),
    ngaythang: date("ngaythang", { mode: "date" }).notNull(),
    // day_name: GENERATED ALWAYS AS — luôn đúng, không cần set trong code
    dayName: text("day_name").generatedAlwaysAs(
      sql`CASE EXTRACT(DOW FROM ngaythang)::int WHEN 0 THEN 'Sun' WHEN 1 THEN 'Mon' WHEN 2 THEN 'Tue' WHEN 3 THEN 'Wed' WHEN 4 THEN 'Thu' WHEN 5 THEN 'Fri' ELSE 'Sat' END`,
    ),
    mucTieuSoGio: doublePrecision("muc_tieu_so_gio").notNull().default(0),
    mucTieuSoNguoi: integer("muc_tieu_so_nguoi").notNull().default(0),
    mucTieuTongGioHc: doublePrecision("muc_tieu_tonggio_hc").notNull().default(0),
    mucTieuTongGioTc: doublePrecision("muc_tieu_tonggio_tc").notNull().default(0),
    mucTieuTongGio: doublePrecision("muc_tieu_tonggio").notNull().default(0),
    mucTieuSoKhoiTheoHc: doublePrecision("muc_tieu_sokhoi_theo_hc").notNull().default(0),
    mucTieuSoKhoiTheoTangCa: doublePrecision("muc_tieu_sokhoi_theo_tangca").notNull().default(0),
    mucTieuSoKhoiTrungBinh: doublePrecision("muc_tieu_sokhoi_trungbinh").notNull().default(0),
    soNguoiHienDienHc: integer("so_nguoi_hiendien_hc").notNull().default(0),
    soNguoiHienDienTc: integer("so_nguoi_hiendien_tc").notNull().default(0),
    veGiuaGio: doublePrecision("ve_giua_gio").notNull().default(0),
    contRoi: doublePrecision("cont_roi").notNull().default(0),
    contRap: doublePrecision("cont_rap").notNull().default(0),
    soKhoiHoanThanh: doublePrecision("sokhoi_hoanthanh").notNull().default(0),
    tongGio: doublePrecision("tonggio").notNull().default(0),
    soKhoi: doublePrecision("sokhoi").notNull().default(0),
    tile: doublePrecision("tile").notNull().default(0),
    tileHoanThanh: doublePrecision("tile_hoanthanh").notNull().default(0),
    gioChenhlech: doublePrecision("gio_chenhlech").notNull().default(0),
    gioCanBu: doublePrecision("gio_canbu").notNull().default(0),
  },
  (t) => ({
    uk: uniqueIndex("mes_muctieu_sanxuat_chitiet_uk").on(t.companyId, t.maCongDoan, t.ngaythang),
  }),
);
