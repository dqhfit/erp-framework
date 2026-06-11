import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

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

  // TODO: Bảng ps_kehoach_donhang CHƯA có trong mapping HYBRID được cung cấp.
  // Giả định là bảng thật PostgreSQL với các cột:
  //   company_id, madonhang, typeid, columnname, ngaykehoach, updated_at
  // Cần xác nhận lược đồ thật + UNIQUE constraint trên
  //   (company_id, madonhang, typeid, columnname) trước khi deploy.
  //
  // LƯU Ý: @ghichu trong proc gốc được khai báo nhưng KHÔNG dùng trong
  // INSERT hoặc UPDATE — bỏ qua có chủ ý (giữ nguyên hành vi nguồn).

  await db.execute(sql`
    INSERT INTO ps_kehoach_donhang (company_id, madonhang, typeid, columnname, ngaykehoach)
    VALUES (${companyId}, ${args.madonhang}, ${args.type_id}, ${args.column_name}, ${args.ngay_kehoach}::date)
    ON CONFLICT (company_id, madonhang, typeid, columnname)
    DO UPDATE SET
      ngaykehoach = EXCLUDED.ngaykehoach,
      updated_at  = now()
  `);

  // TODO: Proc gốc gọi EXEC PS_KEHOACH_DONHANG_HEAD_CREATE @madonhang sau mỗi upsert.
  // Cần port proc đó thành module proc riêng rồi gọi ở đây, ví dụ:
  //   await psKehoachDonhangHeadCreate(db, companyId, { madonhang: args.madonhang });
  // Tác động khi thiếu: bảng head (ps_kehoach_donhang_head?) sẽ không được tạo/cập nhật.
}
