/* ==========================================================
   mes-muctieu-sanxuat.ts — Client wrapper cho tRPC
   mesMucTieuSanXuat.* (MES "Mục tiêu sản xuất").
   ========================================================== */

import type { AppRouter } from "@erp-framework/server";
import { createTRPCClient, httpBatchLink } from "@trpc/client";

export interface MucTieuThangRow {
  id: string;
  nam: number;
  thang: number;
  maBoPhan: string;
  mucThuong: number;
  soNguoi: number;
  soNgay: number;
  phantramTang: number | null;
  col1: number | null;
  col2: number | null;
  col3: number | null;
  col4: number | null;
  col5: number | null;
  col6: number | null;
  col7: number | null;
  col8: number | null;
  col9: number | null;
  col10: number | null;
  col11: number | null;
  col12: number | null;
  col13: number | null;
  col14: number | null;
  col15: number | null;
  col16: number | null;
  col17: number | null;
  col18: string | null;
  col19: number | null;
  col20: number | null;
  col21: number | null;
  col22: number | null;
  col23: number | null;
  col24: number | null;
  col25: number | null;
  updatedAt: string;
}

export interface MucTieuChitietRow {
  id: string;
  maCongDoan: string;
  ngaythang: string; // ISO date string
  dayName: string | null;
  mucTieuSoGio: number;
  mucTieuSoNguoi: number;
  mucTieuTongGioHc: number;
  mucTieuTongGioTc: number;
  mucTieuTongGio: number;
  mucTieuSoKhoiTheoHc: number;
  mucTieuSoKhoiTheoTangCa: number;
  mucTieuSoKhoiTrungBinh: number;
  soNguoiHienDienHc: number;
  soNguoiHienDienTc: number;
  veGiuaGio: number;
  contRoi: number;
  contRap: number;
  soKhoiHoanThanh: number;
  tongGio: number;
  soKhoi: number;
  tile: number;
  tileHoanThanh: number;
  gioChenhlech: number;
  gioCanBu: number;
}

export function createMesMucTieuSanXuatClient(baseUrl: string) {
  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: baseUrl.replace(/\/$/, "") + "/trpc",
        fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
      }),
    ],
  });

  return {
    listBoPhan: () => trpc.mesMucTieuSanXuat.listBoPhan.query() as Promise<string[]>,

    listNam: () => trpc.mesMucTieuSanXuat.listNam.query() as Promise<number[]>,

    listThang: (nam: number, thang: number, maBoPhan: string) =>
      trpc.mesMucTieuSanXuat.listThang.query({ nam, thang, maBoPhan }) as Promise<
        MucTieuThangRow[]
      >,

    initThang: (nam: number, thang: number, maBoPhan: string) =>
      trpc.mesMucTieuSanXuat.initThang.mutate({ nam, thang, maBoPhan }) as Promise<
        MucTieuThangRow[]
      >,

    /** Header nhiều tháng trong khoảng (read-only). */
    listThangRange: (input: {
      namFrom: number;
      thangFrom: number;
      namTo: number;
      thangTo: number;
      maBoPhan: string;
    }) => trpc.mesMucTieuSanXuat.listThangRange.query(input) as Promise<MucTieuThangRow[]>,

    /** Chi tiết hàng ngày trong khoảng [fromDate, toDate] (read-only). */
    listChitietRange: (input: { fromDate: string; toDate: string; maBoPhan: string }) =>
      trpc.mesMucTieuSanXuat.listChitietRange.query(input) as Promise<MucTieuChitietRow[]>,

    saveThang: (input: {
      nam: number;
      thang: number;
      maBoPhan: string;
      mucThuong: number;
      soNguoi: number;
      phantramTang: number | null;
      contRap: number | null;
      tileInput: number | null;
      sotien: number | null;
      soKhoiCongTru: number | null;
    }) => trpc.mesMucTieuSanXuat.saveThang.mutate(input),

    getOrCreateChitiet: (nam: number, thang: number, maBoPhan: string) =>
      trpc.mesMucTieuSanXuat.getOrCreateChitiet.mutate({ nam, thang, maBoPhan }) as Promise<
        MucTieuChitietRow[]
      >,

    saveChitiet: (input: {
      id: string;
      mucTieuSoGio: number;
      soNguoiHcInput: number;
      soNguoiTcInput: number;
      soKhoiHoanThanh: number;
      veGiuaGio: number;
      contRoi: number;
      contRap: number;
    }) => trpc.mesMucTieuSanXuat.saveChitiet.mutate(input),

    tinhtoan: (nam: number, thang: number, maBoPhan: string) =>
      trpc.mesMucTieuSanXuat.tinhtoan.mutate({ nam, thang, maBoPhan }),
  };
}

export type MesMucTieuSanXuatClient = ReturnType<typeof createMesMucTieuSanXuatClient>;
