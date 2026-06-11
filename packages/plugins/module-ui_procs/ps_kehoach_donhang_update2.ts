/* Port PS_KEHOACH_DONHANG_UPDATE2 — upsert ngày kế hoạch của đơn hàng
   theo khoá nghiệp vụ (madonhang, typeid, columnname).
   Nguồn: migration-plan/ui/proc-bodies/ps_kehoach_donhang_update2.sql

   CHÚ Ý: bảng ps_kehoach_donhang CHƯA migrate sang PG — proc sẽ throw
   'entity không tồn tại' khi gọi cho tới khi bảng được migrate. Bảng
   không có trong field-map nên tên field giữ theo T-SQL gốc lowercase
   (madonhang, typeid, columnname, ngaykehoach).

   Upsert theo pattern proc gốc (IF NOT EXISTS → INSERT, ELSE → UPDATE)
   bằng listWhere kiểm tồn tại rồi update/insert — KHÔNG dùng ON CONFLICT
   (bảng thật không có UNIQUE constraint theo khoá nghiệp vụ).

   LƯU Ý: @ghichu trong proc gốc được khai báo nhưng KHÔNG dùng trong
   INSERT hoặc UPDATE — bỏ qua có chủ ý (giữ nguyên hành vi nguồn). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function psKehoachDonhangUpdate2(
  db: DB,
  companyId: string,
  args: {
    madonhang: string;
    type_id: string;
    column_name: string;
    ngay_kehoach: string; // ISO date "YYYY-MM-DD"
    ghichu?: string | null;
  },
): Promise<void> {
  if (!args.madonhang) throw new Error("Thiếu madonhang");
  if (!args.type_id) throw new Error("Thiếu type_id");
  if (!args.column_name) throw new Error("Thiếu column_name");
  if (!args.ngay_kehoach) throw new Error("Thiếu ngay_kehoach");

  const t = await procTable(db, companyId, "ps_kehoach_donhang");

  const where = sql`${t.text("madonhang")} = ${args.madonhang}
    AND ${t.text("typeid")} = ${args.type_id}
    AND ${t.text("columnname")} = ${args.column_name}`;

  const existing = await t.listWhere(where, { limit: 1 });
  if (existing.length > 0) {
    await t.updateWhere({ ngaykehoach: args.ngay_kehoach }, where);
  } else {
    await t.insertRow({
      madonhang: args.madonhang,
      typeid: args.type_id,
      columnname: args.column_name,
      ngaykehoach: args.ngay_kehoach,
    });
  }

  // TODO: Proc gốc gọi EXEC PS_KEHOACH_DONHANG_HEAD_CREATE @madonhang sau mỗi upsert.
  // Cần port proc đó thành module proc riêng rồi gọi ở đây, ví dụ:
  //   await psKehoachDonhangHeadCreate(db, companyId, { madonhang: args.madonhang });
  // Tác động khi thiếu: bảng head (ps_kehoach_donhang_head?) sẽ không được tạo/cập nhật.
}
