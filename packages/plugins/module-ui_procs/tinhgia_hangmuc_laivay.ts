/* Port TINHGIA_HANGMUC_LAIVAY — tính lãi vay hạng mục giá thành.
   Nguồn: migration-plan/ui/proc-bodies/tinhgia_hangmuc_laivay.sql
   Thuần CÔNG THỨC, KHÔNG đụng bảng: @sotien = @tongtien * (1% * 3 tháng).
   Trả 2 OUTPUT của proc gốc: sotien + ghichu (chuỗi cố định).
   Tham số db/companyId không dùng nhưng giữ chữ ký chuẩn (registry nhận
   arity >= 2). */
import type { DB } from "@erp-framework/server/db";

export async function tinhgiaHangmucLaivay(
  _db: DB,
  _companyId: string,
  args: {
    tongtien: number;
  },
): Promise<{ sotien: number; ghichu: string }> {
  const tongtien = Number(args.tongtien ?? 0);
  if (!Number.isFinite(tongtien)) throw new Error("tongtien không hợp lệ");
  // TỔNG CHI PHÍ * 1% * 3 tháng (lãi vay tạm tính chưa gồm trong tổng).
  const sotien = tongtien * (0.01 * 3);
  return {
    sotien,
    ghichu: "[Tổng chi phí (Sản xuất + Ngoài SX)] * 1% * 3 (tháng)",
  };
}
