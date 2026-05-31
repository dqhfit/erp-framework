/* ==========================================================
   mes-muctieu-sanxuat-router.ts — tRPC cho module MES
   "Mục tiêu sản xuất" (port từ DQHF WinForms).

   Endpoints:
   - listThang          : danh sách header 4 mức thưởng cho 1 tháng
   - initThang          : khởi tạo 4 hàng mức thưởng nếu chưa có
   - saveThang          : lưu header (tương đương TR_MUCTIEU_SANXUAT2_SAVE)
   - getOrCreateChitiet : lấy/tạo chi tiết hàng ngày trong tháng
   - saveChitiet        : lưu 1 row chi tiết (tương đương CHITIET_SAVE)
   - tinhtoan           : gọi PG function tính col1..col25
   ========================================================== */

import { mesMucTieuSanXuatChitiet, mesMucTieuSanXuatThang } from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { rbacProcedure, router } from "./trpc";

/* ── Helpers ── */

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getDayName(date: Date): string {
  return DOW_NAMES[date.getDay()] ?? "Mon";
}

function daysInMonth(nam: number, thang: number): Date[] {
  const days: Date[] = [];
  const d = new Date(nam, thang - 1, 1);
  while (d.getMonth() === thang - 1) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

/* ── Input schemas ── */

const ThangInput = z.object({
  nam: z.number().int().min(2000).max(2100),
  thang: z.number().int().min(1).max(12),
  maBoPhan: z.string().min(1),
});

const SaveThangInput = ThangInput.extend({
  mucThuong: z.number().int().min(1).max(4),
  soNguoi: z.number().int().min(0),
  phantramTang: z.number().nullable(),
  contRap: z.number().nullable(), // col2
  tileInput: z.number().nullable(), // col6 — chỉ ghi khi muc_thuong=1
  sotien: z.number().nullable(), // col20
  soKhoiCongTru: z.number().nullable(), // col24
});

const SaveChitietInput = z.object({
  id: z.string().uuid(),
  mucTieuSoGio: z.number().min(0),
  soNguoiHcInput: z.number().int().min(0),
  soNguoiTcInput: z.number().int().min(0),
  soKhoiHoanThanh: z.number().min(0),
  veGiuaGio: z.number().min(0),
  contRoi: z.number().min(0),
  contRap: z.number().min(0),
});

/* ── Router ── */

export const mesMucTieuSanXuatRouter = router({
  /** Danh sách 4 hàng mức thưởng cho 1 tháng / bộ phận. */
  listThang: rbacProcedure("view", "entity")
    .input(ThangInput)
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(mesMucTieuSanXuatThang)
        .where(
          and(
            eq(mesMucTieuSanXuatThang.companyId, ctx.user.companyId),
            eq(mesMucTieuSanXuatThang.nam, input.nam),
            eq(mesMucTieuSanXuatThang.thang, input.thang),
            eq(mesMucTieuSanXuatThang.maBoPhan, input.maBoPhan),
          ),
        )
        .orderBy(asc(mesMucTieuSanXuatThang.mucThuong));
    }),

  /** Tạo 4 hàng mức thưởng nếu chưa tồn tại. Trả về danh sách sau khi init. */
  initThang: rbacProcedure("edit", "entity")
    .input(ThangInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select({ mucThuong: mesMucTieuSanXuatThang.mucThuong })
        .from(mesMucTieuSanXuatThang)
        .where(
          and(
            eq(mesMucTieuSanXuatThang.companyId, ctx.user.companyId),
            eq(mesMucTieuSanXuatThang.nam, input.nam),
            eq(mesMucTieuSanXuatThang.thang, input.thang),
            eq(mesMucTieuSanXuatThang.maBoPhan, input.maBoPhan),
          ),
        );

      const existingLevels = new Set(existing.map((r) => r.mucThuong));
      const toInsert = [1, 2, 3, 4].filter((m) => !existingLevels.has(m));

      if (toInsert.length > 0) {
        await ctx.db.insert(mesMucTieuSanXuatThang).values(
          toInsert.map((mucThuong) => ({
            companyId: ctx.user.companyId,
            nam: input.nam,
            thang: input.thang,
            maBoPhan: input.maBoPhan,
            mucThuong,
          })),
        );
      }

      return ctx.db
        .select()
        .from(mesMucTieuSanXuatThang)
        .where(
          and(
            eq(mesMucTieuSanXuatThang.companyId, ctx.user.companyId),
            eq(mesMucTieuSanXuatThang.nam, input.nam),
            eq(mesMucTieuSanXuatThang.thang, input.thang),
            eq(mesMucTieuSanXuatThang.maBoPhan, input.maBoPhan),
          ),
        )
        .orderBy(asc(mesMucTieuSanXuatThang.mucThuong));
    }),

  /** Lưu header 1 mức thưởng (tương đương TR_MUCTIEU_SANXUAT2_SAVE). */
  saveThang: rbacProcedure("edit", "entity")
    .input(SaveThangInput)
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.query.mesMucTieuSanXuatThang.findFirst({
        where: and(
          eq(mesMucTieuSanXuatThang.companyId, ctx.user.companyId),
          eq(mesMucTieuSanXuatThang.nam, input.nam),
          eq(mesMucTieuSanXuatThang.thang, input.thang),
          eq(mesMucTieuSanXuatThang.maBoPhan, input.maBoPhan),
          eq(mesMucTieuSanXuatThang.mucThuong, input.mucThuong),
        ),
      });
      if (!row)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Chưa init tháng — gọi initThang trước",
        });

      if (input.mucThuong === 1) {
        await ctx.db
          .update(mesMucTieuSanXuatThang)
          .set({
            soNguoi: input.soNguoi,
            phantramTang: null,
            col2: input.contRap ?? row.col2,
            col6: input.tileInput ?? row.col6,
            col20: input.sotien ?? row.col20,
            col24: input.soKhoiCongTru ?? 0,
            updatedAt: new Date(),
          })
          .where(eq(mesMucTieuSanXuatThang.id, row.id));
      } else {
        // Lấy col1, col2, col6 từ mức liền trước để tính cộng % tăng
        const prev = await ctx.db.query.mesMucTieuSanXuatThang.findFirst({
          where: and(
            eq(mesMucTieuSanXuatThang.companyId, ctx.user.companyId),
            eq(mesMucTieuSanXuatThang.nam, input.nam),
            eq(mesMucTieuSanXuatThang.thang, input.thang),
            eq(mesMucTieuSanXuatThang.maBoPhan, input.maBoPhan),
            eq(mesMucTieuSanXuatThang.mucThuong, input.mucThuong - 1),
          ),
        });
        const p = input.phantramTang ?? 0;
        const prevCol2 = prev?.col2 ?? 0;
        const newContRap = prevCol2 + (p * prevCol2) / 100;

        await ctx.db
          .update(mesMucTieuSanXuatThang)
          .set({
            soNguoi: prev?.soNguoi ?? input.soNguoi,
            phantramTang: p,
            col2: newContRap,
            col20: input.sotien ?? row.col20,
            col24: prev?.col24 ?? 0,
            updatedAt: new Date(),
          })
          .where(eq(mesMucTieuSanXuatThang.id, row.id));
      }

      return { ok: true };
    }),

  /** Lấy chi tiết hàng ngày, tạo hàng còn thiếu (tương đương CHITIET_CREATE).
   *  Trả về mảng 28–31 hàng đã sắp theo ngày. */
  getOrCreateChitiet: rbacProcedure("view", "entity")
    .input(ThangInput)
    .query(async ({ ctx, input }) => {
      const { nam, thang, maBoPhan } = input;
      const cid = ctx.user.companyId;

      // Lấy tất cả row hiện có
      const existing = await ctx.db
        .select()
        .from(mesMucTieuSanXuatChitiet)
        .where(
          and(
            eq(mesMucTieuSanXuatChitiet.companyId, cid),
            eq(mesMucTieuSanXuatChitiet.maCongDoan, maBoPhan),
            sql`EXTRACT(YEAR FROM ${mesMucTieuSanXuatChitiet.ngaythang}) = ${nam}`,
            sql`EXTRACT(MONTH FROM ${mesMucTieuSanXuatChitiet.ngaythang}) = ${thang}`,
          ),
        )
        .orderBy(asc(mesMucTieuSanXuatChitiet.ngaythang));

      const existingDates = new Set(
        existing.map((r) => (r.ngaythang as Date).toISOString().slice(0, 10)),
      );

      // Tạo hàng còn thiếu
      const allDays = daysInMonth(nam, thang);
      const missing = allDays.filter((d) => !existingDates.has(d.toISOString().slice(0, 10)));
      if (missing.length > 0) {
        await ctx.db.insert(mesMucTieuSanXuatChitiet).values(
          missing.map((d) => ({
            companyId: cid,
            maCongDoan: maBoPhan,
            ngaythang: d,
            dayName: getDayName(d),
          })),
        );
      }

      // Lấy lại đầy đủ (kể cả vừa tạo)
      return ctx.db
        .select()
        .from(mesMucTieuSanXuatChitiet)
        .where(
          and(
            eq(mesMucTieuSanXuatChitiet.companyId, cid),
            eq(mesMucTieuSanXuatChitiet.maCongDoan, maBoPhan),
            sql`EXTRACT(YEAR FROM ${mesMucTieuSanXuatChitiet.ngaythang}) = ${nam}`,
            sql`EXTRACT(MONTH FROM ${mesMucTieuSanXuatChitiet.ngaythang}) = ${thang}`,
          ),
        )
        .orderBy(asc(mesMucTieuSanXuatChitiet.ngaythang));
    }),

  /** Lưu 1 row chi tiết (tương đương TR_MUCTIEU_SANXUAT2_CHITIET_SAVE).
   *  Tính lại tonggio, gio_chenhlech ngay tại đây. */
  saveChitiet: rbacProcedure("edit", "entity")
    .input(SaveChitietInput)
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.query.mesMucTieuSanXuatChitiet.findFirst({
        where: and(
          eq(mesMucTieuSanXuatChitiet.id, input.id),
          eq(mesMucTieuSanXuatChitiet.companyId, ctx.user.companyId),
        ),
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      const ngay = row.ngaythang as Date;
      const nam = ngay.getFullYear();
      const thang = ngay.getMonth() + 1;
      const isSun = ngay.getDay() === 0;

      // Lấy songuoi và tile (col6) từ header muc_thuong=1
      const header = await ctx.db.query.mesMucTieuSanXuatThang.findFirst({
        where: and(
          eq(mesMucTieuSanXuatThang.companyId, ctx.user.companyId),
          eq(mesMucTieuSanXuatThang.nam, nam),
          eq(mesMucTieuSanXuatThang.thang, thang),
          eq(mesMucTieuSanXuatThang.maBoPhan, row.maCongDoan),
          eq(mesMucTieuSanXuatThang.mucThuong, 1),
        ),
      });

      let soNguoi = header?.soNguoi ?? 0;
      const tile = header?.col6 ?? 0;

      // Nếu không nhập giờ → số người = 0
      if (input.mucTieuSoGio <= 0) soNguoi = 0;

      // Tính tổng giờ mục tiêu
      const mucTieuTongGioHc = isSun ? 0 : soNguoi * 8;
      const mucTieuTongGioTc = isSun ? soNguoi * 8 : soNguoi * Math.max(0, input.mucTieuSoGio - 8);
      const mucTieuTongGio = mucTieuTongGioHc + mucTieuTongGioTc;

      // Tính tổng giờ thực tế
      const soGioThucTe = input.mucTieuSoGio > 0 ? input.mucTieuSoGio : 0;
      const tongGio = isSun
        ? input.soNguoiTcInput * 8 - input.veGiuaGio
        : input.soNguoiHcInput * 8 +
          input.soNguoiTcInput * Math.max(0, soGioThucTe - 8) -
          input.veGiuaGio;

      const gioChenhlech = mucTieuTongGioHc - tongGio;

      await ctx.db
        .update(mesMucTieuSanXuatChitiet)
        .set({
          mucTieuSoGio: input.mucTieuSoGio,
          mucTieuSoNguoi: soNguoi,
          mucTieuTongGioHc,
          mucTieuTongGioTc,
          mucTieuTongGio,
          soNguoiHienDienHc: input.soNguoiHcInput,
          soNguoiHienDienTc: input.soNguoiTcInput,
          veGiuaGio: input.veGiuaGio,
          contRoi: input.contRoi,
          contRap: input.contRap,
          soKhoiHoanThanh: input.soKhoiHoanThanh,
          tongGio,
          tile: soGioThucTe > 0 ? tile : 0,
          gioChenhlech,
        })
        .where(eq(mesMucTieuSanXuatChitiet.id, input.id));

      return { ok: true };
    }),

  /** Gọi PG function mes_muctieu_tinhtoan — tính lại col1..col25 + cập nhật chitiet. */
  tinhtoan: rbacProcedure("edit", "entity")
    .input(ThangInput)
    .mutation(async ({ ctx, input }) => {
      await ctx.db.execute(
        sql`SELECT mes_muctieu_tinhtoan(
          ${ctx.user.companyId}::uuid,
          ${input.nam}::int,
          ${input.thang}::int,
          ${input.maBoPhan}::text
        )`,
      );
      return { ok: true };
    }),
});
