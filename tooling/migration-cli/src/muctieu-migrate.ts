/* ==========================================================
   muctieu-migrate.ts — Migrate dữ liệu "Mục tiêu sản xuất" từ
   MSSQL DQHF (tr_muctieu_sanxuat2 + chitiet) sang PostgreSQL ERP
   (mes_muctieu_sanxuat_thang + chitiet), bản CLI standalone.

   Port nguyên logic upsert từ tRPC `mesMucTieuMigrateRouter`
   (packages/server/src/mes-muctieu-migrate-router.ts) — vốn chạy
   sau wizard UI. Upsert theo unique key → an toàn chạy lại nhiều lần.

   Chế độ:
     --list                  In danh sách (nam, thang, mabophan) có dữ liệu.
     --nam N --thang T --bo-phan BP   Migrate đúng 1 cặp.
     --all                   Migrate TẤT CẢ cặp (có thể lọc thêm bằng
                             --nam / --thang / --bo-phan để thu hẹp).

   Env: MSSQL_CONNECTION_STRING (nguồn) + DATABASE_URL (đích) +
        MIGRATION_COMPANY_ID (tùy chọn — mặc định company đầu tiên).
   ========================================================== */

import { MssqlClient } from "@erp-framework/mssql-client";
import { mesMucTieuSanXuatChitiet, mesMucTieuSanXuatThang } from "@erp-framework/db";
import { sql } from "drizzle-orm";
import { closeDb, db } from "./ai/db.js";
import { resolveCompanyId } from "./ai/llm-client.js";

export interface MucTieuMigrateOptions {
  /** Chỉ in danh sách sẵn có rồi thoát. */
  list?: boolean;
  /** Migrate tất cả cặp (nam, thang, bộ phận). */
  all?: boolean;
  /** Lọc / chỉ định năm. */
  nam?: number;
  /** Lọc / chỉ định tháng. */
  thang?: number;
  /** Lọc / chỉ định bộ phận (mabophan / macongdoan). */
  maBoPhan?: string;
  /** Override company target (mặc định resolveCompanyId()). */
  companyId?: string;
}

interface AvailItem {
  nam: number;
  thang: number;
  ma_bo_phan: string;
  so_muc_thuong: number;
}

/** Danh sách (nam, thang, mabophan) có dữ liệu — col13 > 0 (giống router). */
async function listAvailable(client: MssqlClient): Promise<AvailItem[]> {
  return client.query<AvailItem>(`
    SELECT DISTINCT nam, thang, mabophan AS ma_bo_phan,
      COUNT(*) OVER (PARTITION BY nam, thang, mabophan) AS so_muc_thuong
    FROM tr_muctieu_sanxuat2
    WHERE col13 > 0
    ORDER BY nam DESC, thang DESC, mabophan
  `);
}

/** Migrate 1 cặp (nam, thang, bộ phận): MSSQL → PG. Upsert an toàn re-run. */
async function migrateOne(
  client: MssqlClient,
  companyId: string,
  nam: number,
  thang: number,
  maBoPhan: string,
): Promise<{ headersUpserted: number; chitietUpserted: number }> {
  // ── 1. Header (tr_muctieu_sanxuat2) ────────────────────────────────────
  const rH = await client.query<Record<string, any>>(
    `SELECT nam, thang, mabophan, mucthuong, songuoi, songay, phantram_tang,
       col1,col2,col3,col4,col5,col6,col7,col8,col9,col10,
       col11,col12,col13,col14,col15,col16,col17,col18,col19,col20,
       col21,col22,col23,col24,col25
     FROM tr_muctieu_sanxuat2
     WHERE nam=@nam AND thang=@thang AND mabophan=@bp`,
    { nam, thang, bp: maBoPhan },
  );

  let headersUpserted = 0;
  for (const r of rH) {
    await db
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

  // ── 2. Chi tiết (tr_muctieu_sanxuat2_chitiet) ──────────────────────────
  const rC = await client.query<Record<string, any>>(
    `SELECT macongdoan, ngaythang,
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
     ORDER BY ngaythang`,
    { nam, thang, bp: maBoPhan },
  );

  let chitietUpserted = 0;
  const BATCH = 50;
  for (let i = 0; i < rC.length; i += BATCH) {
    const batch = rC.slice(i, i + BATCH);
    await db
      .insert(mesMucTieuSanXuatChitiet)
      .values(
        batch.map((r) => ({
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

  return { headersUpserted, chitietUpserted };
}

export async function runMucTieuMigrate(opts: MucTieuMigrateOptions): Promise<void> {
  const client = MssqlClient.fromEnv();
  await client.connect();
  try {
    if (opts.list) {
      const rows = await listAvailable(client);
      console.log(`▸ ${rows.length} cặp (nam, thang, bộ phận) có dữ liệu (col13 > 0):\n`);
      for (const r of rows) {
        console.log(
          `  ${r.nam}  T${String(r.thang).padStart(2, "0")}  ${r.ma_bo_phan}  (${r.so_muc_thuong} mức thưởng)`,
        );
      }
      return;
    }

    const companyId = await resolveCompanyId(opts.companyId);

    // Xác định tập cặp cần migrate.
    let targets: Array<{ nam: number; thang: number; maBoPhan: string }>;
    if (opts.all) {
      const rows = await listAvailable(client);
      targets = rows
        .filter(
          (r) =>
            (opts.nam == null || r.nam === opts.nam) &&
            (opts.thang == null || r.thang === opts.thang) &&
            (opts.maBoPhan == null || r.ma_bo_phan === opts.maBoPhan),
        )
        .map((r) => ({ nam: r.nam, thang: r.thang, maBoPhan: r.ma_bo_phan }));
      if (targets.length === 0) {
        throw new Error("Không có cặp nào khớp bộ lọc --nam/--thang/--bo-phan.");
      }
    } else {
      if (opts.nam == null || opts.thang == null || !opts.maBoPhan) {
        throw new Error(
          "Thiếu tham số. Cần --nam --thang --bo-phan cho 1 cặp, hoặc --all (kèm lọc tùy ý), hoặc --list để xem.",
        );
      }
      targets = [{ nam: opts.nam, thang: opts.thang, maBoPhan: opts.maBoPhan }];
    }

    console.log(`▸ Migrate ${targets.length} cặp → company ${companyId}\n`);
    let totH = 0;
    let totC = 0;
    const errors: string[] = [];
    for (const tg of targets) {
      const label = `${tg.maBoPhan} ${tg.thang}/${tg.nam}`;
      try {
        // Upsert an toàn re-run → 1 cặp lỗi KHÔNG vứt phần đã chạy.
        const r = await migrateOne(client, companyId, tg.nam, tg.thang, tg.maBoPhan);
        totH += r.headersUpserted;
        totC += r.chitietUpserted;
        console.log(`  ✓ ${label} — header ${r.headersUpserted}, chi tiết ${r.chitietUpserted}`);
      } catch (e) {
        errors.push(`${label}: ${(e as Error).message}`);
        console.error(`  ✗ ${label} — ${(e as Error).message}`);
      }
    }

    console.log(
      `\n▸ Xong: ${targets.length - errors.length}/${targets.length} cặp OK — ` +
        `${totH} header, ${totC} chi tiết upserted.`,
    );
    if (errors.length > 0) {
      console.error(`✗ ${errors.length} cặp lỗi:\n  ${errors.join("\n  ")}`);
      process.exit(1);
    }
  } finally {
    await client.close();
    // Đóng pool PG để process thoát sạch (không treo sau khi xong).
    await closeDb();
  }
}
