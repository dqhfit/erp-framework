/* Port TR_MUCTIEU_SANXUAT_DELETEALL — xoá toàn bộ mục tiêu sản xuất
   theo năm + tháng + công đoạn.
   Nguồn: migration-plan/ui/proc-bodies/tr_muctieu_sanxuat_deleteall.sql

   Bảng tr_muctieu_sanxuat CHƯA migrate sang PG — proc sẽ throw
   "entity không tồn tại" khi gọi, cần đưa bảng vào scope migrate trước.
   (procTable tự fail-fast với message rõ.)

   LƯU Ý: trên prod hiện có entity tr_muctieu_sanxuat2 nhưng schema KHÁC
   hẳn (nam/thang/mabophan, không có ngaythang/macongdoan) — có khả năng
   bảng nguồn được đổi tên/đổi cấu trúc khi migrate. KHÔNG tự ý đổi tên
   entity ở đây; cần xác nhận nghiệp vụ trước khi map sang bảng "2". */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trMuctieuSanxuatDeleteall(
  db: DB,
  companyId: string,
  args: {
    year: number;
    month: number;
    macongdoan: string;
  },
): Promise<number> {
  if (!args.year) throw new Error("Thiếu year");
  if (!args.month) throw new Error("Thiếu month");
  if (!args.macongdoan) throw new Error("Thiếu macongdoan");

  const t = await procTable(db, companyId, "tr_muctieu_sanxuat");
  // Proc gốc: DELETE ... WHERE YEAR(ngaythang) = @year
  //   AND MONTH(ngaythang) = @month AND macongdoan = @macongdoan.
  // Hệ mới dùng soft-delete (deleted_at) cho bảng thật — chuẩn thay cho DELETE.
  return t.softDeleteWhere(sql`
    EXTRACT(YEAR FROM ${t.ts("ngaythang")}) = ${args.year}
    AND EXTRACT(MONTH FROM ${t.ts("ngaythang")}) = ${args.month}
    AND ${t.text("macongdoan")} = ${args.macongdoan}
  `);
}
