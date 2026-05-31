/* ==========================================================
   mes-muctieu-migrate-router.ts — Migrate dữ liệu MSSQL DQHF
   (tr_muctieu_sanxuat2 + chitiet) sang PostgreSQL ERP.

   Endpoints:
   - listAvailable  : danh sách (nam, thang, mabophan) có trong MSSQL
   - preview        : đếm records sẽ migrate cho 1 cặp (nam, thang, mabophan)
   - migrateMonth   : copy MSSQL → PG (upsert an toàn, re-runnable)
   - markPorted     : đánh dấu form DQHF = 'xong' trong legacy_menu_map
   ========================================================== */

import { legacyMenuMap, mesMucTieuSanXuatChitiet, mesMucTieuSanXuatThang } from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { openDefaultMssql } from "./migration-router";
import { rbacProcedure, router } from "./trpc";

/* ── Input schemas ── */
const MonthBpInput = z.object({
  nam: z.number().int().min(2000).max(2100),
  thang: z.number().int().min(1).max(12),
  maBoPhan: z.string().min(1),
});

export const mesMucTieuMigrateRouter = router({
  /** Danh sách (nam, thang, mabophan) có trong MSSQL — dùng để chọn phạm vi migrate. */
  listAvailable: rbacProcedure("edit", "settings").query(async ({ ctx }) => {
    const client = await openDefaultMssql(ctx.db, ctx.user.companyId);
    try {
      const r = await (client as any)["pool"].request().query(`
        SELECT DISTINCT nam, thang, mabophan AS ma_bo_phan,
          COUNT(*) OVER (PARTITION BY nam, thang, mabophan) AS so_muc_thuong
        FROM tr_muctieu_sanxuat2
        WHERE col13 > 0
        ORDER BY nam DESC, thang DESC, mabophan
      `);
      return r.recordset as Array<{
        nam: number;
        thang: number;
        ma_bo_phan: string;
        so_muc_thuong: number;
      }>;
    } finally {
      await client.close();
    }
  }),

  /** Preview: đếm records header + chitiet sẽ migrate. */
  preview: rbacProcedure("edit", "settings")
    .input(MonthBpInput)
    .query(async ({ ctx, input }) => {
      const client = await openDefaultMssql(ctx.db, ctx.user.companyId);
      try {
        const pool = (client as any)["pool"];
        const [rH, rC] = await Promise.all([
          pool
            .request()
            .input("nam", input.nam)
            .input("thang", input.thang)
            .input("bp", input.maBoPhan)
            .query(`SELECT COUNT(*) AS cnt FROM tr_muctieu_sanxuat2
                    WHERE nam=@nam AND thang=@thang AND mabophan=@bp`),
          pool
            .request()
            .input("nam", input.nam)
            .input("thang", input.thang)
            .input("bp", input.maBoPhan)
            .query(`SELECT COUNT(*) AS cnt FROM tr_muctieu_sanxuat2_chitiet
                    WHERE YEAR(ngaythang)=@nam AND MONTH(ngaythang)=@thang AND macongdoan=@bp`),
        ]);
        return {
          header: rH.recordset[0].cnt as number,
          chitiet: rC.recordset[0].cnt as number,
        };
      } finally {
        await client.close();
      }
    }),

  /** Migrate 1 tháng / bộ phận: MSSQL → PG (upsert — an toàn chạy nhiều lần). */
  migrateMonth: rbacProcedure("edit", "settings")
    .input(MonthBpInput)
    .mutation(async ({ ctx, input }) => {
      const { nam, thang, maBoPhan } = input;
      const companyId = ctx.user.companyId;
      const client = await openDefaultMssql(ctx.db, ctx.user.companyId);
      try {
        const pool = (client as any)["pool"];

        // ── 1. Header (tr_muctieu_sanxuat2) ─────────────────────────────────
        const rH = await pool
          .request()
          .input("nam", nam)
          .input("thang", thang)
          .input("bp", maBoPhan)
          .query(`
            SELECT nam, thang, mabophan, mucthuong, songuoi, songay, phantram_tang,
              col1,col2,col3,col4,col5,col6,col7,col8,col9,col10,
              col11,col12,col13,col14,col15,col16,col17,col18,col19,col20,
              col21,col22,col23,col24,col25
            FROM tr_muctieu_sanxuat2
            WHERE nam=@nam AND thang=@thang AND mabophan=@bp
          `);

        let headersUpserted = 0;
        for (const r of rH.recordset) {
          await ctx.db
            .insert(mesMucTieuSanXuatThang)
            .values({
              companyId,
              nam: r.nam,
              thang: r.thang,
              maBoPhan: r.mabophan,
              mucThuong: r.mucthuong,
              soNguoi: r.songuoi ?? 0,
              soNgay: r.songay ?? 0,
              phantramTang: r.phantram_tang,
              col1: r.col1,
              col2: r.col2,
              col3: r.col3,
              col4: r.col4,
              col5: r.col5,
              col6: r.col6,
              col7: r.col7,
              col8: r.col8,
              col9: r.col9,
              col10: r.col10,
              col11: r.col11,
              col12: r.col12,
              col13: r.col13,
              col14: r.col14,
              col15: r.col15,
              col16: r.col16,
              col17: r.col17,
              col18: r.col18 ?? "",
              col19: r.col19,
              col20: r.col20,
              col21: r.col21,
              col22: r.col22,
              col23: r.col23,
              col24: r.col24,
              col25: r.col25,
            })
            .onConflictDoUpdate({
              target: [
                mesMucTieuSanXuatThang.companyId,
                mesMucTieuSanXuatThang.nam,
                mesMucTieuSanXuatThang.thang,
                mesMucTieuSanXuatThang.maBoPhan,
                mesMucTieuSanXuatThang.mucThuong,
              ],
              set: {
                soNguoi: sql`excluded.so_nguoi`,
                soNgay: sql`excluded.so_ngay`,
                phantramTang: sql`excluded.phantram_tang`,
                col1: sql`excluded.col1`,
                col2: sql`excluded.col2`,
                col3: sql`excluded.col3`,
                col4: sql`excluded.col4`,
                col5: sql`excluded.col5`,
                col6: sql`excluded.col6`,
                col7: sql`excluded.col7`,
                col8: sql`excluded.col8`,
                col9: sql`excluded.col9`,
                col10: sql`excluded.col10`,
                col11: sql`excluded.col11`,
                col12: sql`excluded.col12`,
                col13: sql`excluded.col13`,
                col14: sql`excluded.col14`,
                col15: sql`excluded.col15`,
                col16: sql`excluded.col16`,
                col17: sql`excluded.col17`,
                col18: sql`excluded.col18`,
                col19: sql`excluded.col19`,
                col20: sql`excluded.col20`,
                col21: sql`excluded.col21`,
                col22: sql`excluded.col22`,
                col23: sql`excluded.col23`,
                col24: sql`excluded.col24`,
                col25: sql`excluded.col25`,
                updatedAt: sql`now()`,
              },
            });
          headersUpserted++;
        }

        // ── 2. Chi tiết (tr_muctieu_sanxuat2_chitiet) ───────────────────────
        const rC = await pool
          .request()
          .input("nam", nam)
          .input("thang", thang)
          .input("bp", maBoPhan)
          .query(`
            SELECT macongdoan, ngaythang,
              ISNULL(muctieu_sogio, 0) AS muctieu_sogio,
              ISNULL(muctieu_songuoi, 0) AS muctieu_songuoi,
              ISNULL(muctieu_tonggio_hc, 0) AS muctieu_tonggio_hc,
              ISNULL(muctieu_tonggio_tc, 0) AS muctieu_tonggio_tc,
              ISNULL(muctieu_tonggio, 0) AS muctieu_tonggio,
              ISNULL(muctieu_sokhoi_theo_hc, 0) AS muctieu_sokhoi_theo_hc,
              ISNULL(muctieu_sokhoi_theo_tangca, 0) AS muctieu_sokhoi_theo_tangca,
              ISNULL(muctieu_sokhoi_trungbinh, 0) AS muctieu_sokhoi_trungbinh,
              ISNULL(songuoi_hiendien_hc, 0) AS songuoi_hiendien_hc,
              ISNULL(songuoi_hiendien_tc, 0) AS songuoi_hiendien_tc,
              ISNULL(vegiuagio, 0) AS vegiuagio,
              ISNULL(cont_roi, 0) AS cont_roi,
              ISNULL(cont_rap, 0) AS cont_rap,
              ISNULL(sokhoi_hoanthanh, 0) AS sokhoi_hoanthanh,
              ISNULL(tonggio, 0) AS tonggio,
              ISNULL(sokhoi, 0) AS sokhoi,
              ISNULL(tile, 0) AS tile,
              ISNULL(tile_hoanthanh, 0) AS tile_hoanthanh,
              ISNULL(giochenhlech, 0) AS giochenhlech
            FROM tr_muctieu_sanxuat2_chitiet
            WHERE YEAR(ngaythang)=@nam AND MONTH(ngaythang)=@thang AND macongdoan=@bp
            ORDER BY ngaythang
          `);

        let chitietUpserted = 0;
        // Batch insert 50 rows/lần để tránh statement quá lớn
        const BATCH = 50;
        for (let i = 0; i < rC.recordset.length; i += BATCH) {
          const batch = rC.recordset.slice(i, i + BATCH);
          await ctx.db
            .insert(mesMucTieuSanXuatChitiet)
            .values(
              batch.map((r: any) => ({
                companyId,
                maCongDoan: r.macongdoan,
                ngaythang: new Date(r.ngaythang),
                mucTieuSoGio: r.muctieu_sogio,
                mucTieuSoNguoi: r.muctieu_songuoi,
                mucTieuTongGioHc: r.muctieu_tonggio_hc,
                mucTieuTongGioTc: r.muctieu_tonggio_tc,
                mucTieuTongGio: r.muctieu_tonggio,
                mucTieuSoKhoiTheoHc: r.muctieu_sokhoi_theo_hc,
                mucTieuSoKhoiTheoTangCa: r.muctieu_sokhoi_theo_tangca,
                mucTieuSoKhoiTrungBinh: r.muctieu_sokhoi_trungbinh,
                soNguoiHienDienHc: r.songuoi_hiendien_hc,
                soNguoiHienDienTc: r.songuoi_hiendien_tc,
                veGiuaGio: r.vegiuagio,
                contRoi: r.cont_roi,
                contRap: r.cont_rap,
                soKhoiHoanThanh: r.sokhoi_hoanthanh,
                tongGio: r.tonggio,
                soKhoi: r.sokhoi,
                tile: r.tile,
                tileHoanThanh: r.tile_hoanthanh,
                gioChenhlech: r.giochenhlech,
              })),
            )
            .onConflictDoUpdate({
              target: [
                mesMucTieuSanXuatChitiet.companyId,
                mesMucTieuSanXuatChitiet.maCongDoan,
                mesMucTieuSanXuatChitiet.ngaythang,
              ],
              set: {
                mucTieuSoGio: sql`excluded.muc_tieu_so_gio`,
                mucTieuSoNguoi: sql`excluded.muc_tieu_so_nguoi`,
                mucTieuTongGioHc: sql`excluded.muc_tieu_tonggio_hc`,
                mucTieuTongGioTc: sql`excluded.muc_tieu_tonggio_tc`,
                mucTieuTongGio: sql`excluded.muc_tieu_tonggio`,
                mucTieuSoKhoiTheoHc: sql`excluded.muc_tieu_sokhoi_theo_hc`,
                mucTieuSoKhoiTheoTangCa: sql`excluded.muc_tieu_sokhoi_theo_tangca`,
                mucTieuSoKhoiTrungBinh: sql`excluded.muc_tieu_sokhoi_trungbinh`,
                soNguoiHienDienHc: sql`excluded.so_nguoi_hiendien_hc`,
                soNguoiHienDienTc: sql`excluded.so_nguoi_hiendien_tc`,
                veGiuaGio: sql`excluded.ve_giua_gio`,
                contRoi: sql`excluded.cont_roi`,
                contRap: sql`excluded.cont_rap`,
                soKhoiHoanThanh: sql`excluded.sokhoi_hoanthanh`,
                tongGio: sql`excluded.tonggio`,
                soKhoi: sql`excluded.sokhoi`,
                tile: sql`excluded.tile`,
                tileHoanThanh: sql`excluded.tile_hoanthanh`,
                gioChenhlech: sql`excluded.gio_chenhlech`,
              },
            });
          chitietUpserted += batch.length;
        }

        return { ok: true, headersUpserted, chitietUpserted };
      } finally {
        await client.close();
      }
    }),

  /** Đánh dấu form DQHF là 'xong' trong legacy_menu_map (cockpit). */
  markPorted: rbacProcedure("edit", "settings")
    .input(
      z.object({
        sourceCode: z.string().min(1),
        pageRoute: z.string().default("/mes/muctieu-sanxuat"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(legacyMenuMap)
        .set({
          portStatus: "xong",
          module: "mes_muctieu_sanxuat",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(legacyMenuMap.companyId, ctx.user.companyId),
            eq(legacyMenuMap.sourceCode, input.sourceCode),
          ),
        )
        .returning({ id: legacyMenuMap.id });
      if (!row)
        throw new TRPCError({ code: "NOT_FOUND", message: "Form không tồn tại trong danh mục" });
      return { ok: true };
    }),

  /** Danh sách form DQHF liên quan đến mục tiêu sản xuất trong cockpit. */
  listRelatedForms: rbacProcedure("view", "settings").query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: legacyMenuMap.id,
        sourceCode: legacyMenuMap.sourceCode,
        name: legacyMenuMap.name,
        winId: legacyMenuMap.winId,
        portStatus: legacyMenuMap.portStatus,
        module: legacyMenuMap.module,
      })
      .from(legacyMenuMap)
      .where(
        and(
          eq(legacyMenuMap.companyId, ctx.user.companyId),
          sql`(
            lower(${legacyMenuMap.winId}) LIKE '%muctieu%'
            OR lower(${legacyMenuMap.name}) LIKE '%mục tiêu%'
            OR lower(${legacyMenuMap.name}) LIKE '%muc tieu%'
            OR lower(${legacyMenuMap.winId}) LIKE '%baocaohiendien%'
          )`,
        ),
      );
    return rows;
  }),
});
