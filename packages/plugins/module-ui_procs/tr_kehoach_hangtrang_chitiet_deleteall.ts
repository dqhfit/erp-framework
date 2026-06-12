/* Port TR_KEHOACH_HANGTRANG_CHITIET_DELETEALL — dọn chi tiết kế hoạch
   hàng trắng theo công đoạn + danh sách mã đơn hàng, 2 bước theo proc gốc:

   Bước 1: auto-xác-nhận MỌI chi tiết quá khứ của công ty
     UPDATE chitiet SET xacnhan = 1 WHERE ngaythang < hôm nay
     (proc gốc không lọc theo tham số ở bước này — giữ nguyên).

   Bước 2: xoá chi tiết CHƯA xác nhận thuộc các kế hoạch cha khớp
     congdoan + madonhang (tham số là chuỗi CSV, string_split + trim)
     mà cha chưa hoàn thành + chưa xác nhận.
     DELETE của T-SQL → soft-delete (deleted_at) theo chuẩn hệ mới;
     listWhere của procTable đã scope deleted_at IS NULL nên các lần
     gọi sau không đếm lại row đã xoá.

   2 bảng: tr_kehoach_hangtrang (cha, PK id_kehoach) +
   tr_kehoach_hangtrang_chitiet (con, FK id_kehoach).
   Nguồn: migration-plan/ui/proc-bodies/tr_kehoach_hangtrang_chitiet_deleteall.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trKehoachHangtrangChitietDeleteall(
  db: DB,
  companyId: string,
  args: {
    congdoan: string;
    /** CSV như tham số @madonhang nvarchar(MAX) của proc gốc, vd "DH01, DH02" */
    madonhang: string;
  },
): Promise<{ confirmed: number; deleted: number }> {
  if (!args.congdoan) throw new Error("Thiếu congdoan");
  if (!args.madonhang) throw new Error("Thiếu madonhang");

  const chitiet = await procTable(db, companyId, "tr_kehoach_hangtrang_chitiet");

  // Bước 1: xacnhan = 1 cho mọi chi tiết có ngaythang trước hôm nay
  const confirmed = await chitiet.updateWhere(
    { xacnhan: 1 },
    sql`${chitiet.ts("ngaythang")} < CURRENT_DATE`,
  );

  // Bước 2: tách CSV madonhang (LTRIM/RTRIM từng phần tử như string_split gốc)
  const maList = args.madonhang
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (maList.length === 0) return { confirmed, deleted: 0 };

  // Lấy id_kehoach cha khớp: congdoan + madonhang IN list + chưa hoàn thành
  // + chưa xác nhận (COALESCE(bit, 0) = 0 gốc → coalesce(bool, false) = false)
  const kehoach = await procTable(db, companyId, "tr_kehoach_hangtrang");
  const parents = await kehoach.listWhere(sql`
    ${kehoach.text("congdoan")} = ${args.congdoan}
    AND ${kehoach.text("madonhang")} IN (SELECT unnest(${maList}::text[]))
    AND coalesce(${kehoach.bool("hoanthanh")}, false) = false
    AND coalesce(${kehoach.bool("xacnhan")}, false) = false
  `);
  const ids = parents
    .map((p) => p.id_kehoach)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (ids.length === 0) return { confirmed, deleted: 0 };

  // Xoá chi tiết chưa xác nhận thuộc các kế hoạch trên
  const deleted = await chitiet.softDeleteWhere(sql`
    ${chitiet.text("id_kehoach")} IN (SELECT unnest(${ids}::text[]))
    AND coalesce(${chitiet.bool("xacnhan")}, false) = false
  `);
  return { confirmed, deleted };
}
