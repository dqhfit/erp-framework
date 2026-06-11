import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

export async function trTrangThaiSanXuatXacNhan(
  db: DB,
  companyId: string,
  args: {
    id: string;
    soluong: number;
    ngaygiao: Date;
    nguoinhan: string;
  },
): Promise<void> {
  if (!args.id) throw new Error("Thiếu id");
  if (args.soluong == null) throw new Error("Thiếu soluong");
  if (!args.ngaygiao) throw new Error("Thiếu ngaygiao");
  if (!args.nguoinhan) throw new Error("Thiếu nguoinhan");

  // Đọc thông tin dòng cần xác nhận từ bảng thật
  // Lưu ý: T-SQL gốc có bug @congdoan = @congdoan (tự gán, không đọc từ bảng);
  // block IF dùng @congdoan đã bị comment out nên không ảnh hưởng — bỏ qua ở đây.
  const selectRows = await db.execute<{
    mact: string | null;
    masp1: string | null;
    dayy: number | null;
    rong: number | null;
    dai: number | null;
  }>(sql`
    SELECT mact, masp1, dayy, rong, dai
    FROM tr_trangthai_sanxuat
    WHERE id = ${args.id}
      AND company_id = ${companyId}
      AND deleted_at IS NULL
  `);

  const row = (
    selectRows as unknown as Array<{
      mact: string | null;
      masp1: string | null;
      dayy: number | null;
      rong: number | null;
      dai: number | null;
    }>
  )[0];

  if (!row) throw new Error("Không tìm thấy bản ghi tr_trangthai_sanxuat");

  let sokhoi: number;

  if (row.mact === "000") {
    // TODO: bảng tr_sanpham không có trong mapping được cung cấp.
    // Giả định đây là BẢNG THẬT PostgreSQL `tr_sanpham` với cột masp (text) và m3_tc (numeric).
    // Cần xác nhận tên bảng + tên cột thực tế trước khi deploy.
    const spRows = await db.execute<{ m3_tc: number | null }>(sql`
      SELECT m3_tc
      FROM tr_sanpham
      WHERE masp = ${row.masp1}
        AND company_id = ${companyId}
        AND deleted_at IS NULL
      LIMIT 1
    `);
    const sp = (spRows as unknown as Array<{ m3_tc: number | null }>)[0];
    sokhoi = sp?.m3_tc ?? 0;
  } else {
    const dayy = row.dayy ?? 0;
    const rong = row.rong ?? 0;
    const dai = row.dai ?? 0;
    sokhoi = (dayy * rong * dai * args.soluong) / 1_000_000_000;
  }

  await db.execute(sql`
    UPDATE tr_trangthai_sanxuat
    SET ngaygiao   = ${args.ngaygiao},
        nguoinhan  = ${args.nguoinhan},
        soluong    = ${args.soluong},
        sokhoi     = ${sokhoi},
        updated_at = now()
    WHERE id = ${args.id}
      AND company_id = ${companyId}
  `);
}
