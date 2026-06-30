import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

/* ==========================================================
   phoi_khoiluong_dh — Tổng hợp KHỐI LƯỢNG PHÔI (số khối) theo ĐƠN HÀNG (HTR).

   Dùng cho panel tham chiếu nhỏ trong popup thêm/sửa "Đề xuất phôi": chọn
   đơn hàng → hiện nguyên liệu / dày tinh chế / tổng số khối cần.

   Công thức (đối chiếu khớp 100% với màn DQHF, đơn DQH-VFM31/0626):
   - Nguồn: tr_dondathang_chitiet (chi tiết đơn HTR) JOIN tr_dinhmuc_govan
     theo masp (mỗi sản phẩm trong đơn × định mức gỗ ván của nó).
   - m3_tc đã = dày×rộng×dài×SL_định_mức / 1e9 cho mỗi chi tiết phôi.
   - Tổng số khối = Σ ( dm.m3_tc × od.soluong ), nhóm theo (nguyên liệu, dày_tc).
   - Loại nguyên liệu rỗng/"0" và dòng m3_tc = 0 (chi tiết không phải phôi gỗ).
   Scope company_id cả 2 bảng (đa-tenant).
   ========================================================== */
export async function phoiKhoiluongTheoDonHang(
  db: DB,
  companyId: string,
  args: { maddh?: string | string[] },
): Promise<Array<{ nguyenlieu: string; dayy_tc: number; tong_sokhoi: number }>> {
  const raw = args.maddh;
  const list = (Array.isArray(raw) ? raw : String(raw ?? "").split(","))
    .map((s) => String(s).trim())
    .filter(Boolean);
  if (list.length === 0) return [];
  const arr = sql`ARRAY[${sql.join(
    list.map((s) => sql`${s}`),
    sql`, `,
  )}]::text[]`;

  const rows = (await db.execute(sql`
    SELECT dm.f_nguyenlieu AS nguyenlieu,
           dm.f_dayy_tc AS dayy_tc,
           round(sum(dm.f_m3_tc * od.f_soluong)::numeric, 5) AS tong_sokhoi
    FROM tr_dondathang_chitiet od
    JOIN tr_dinhmuc_govan dm
      ON dm.f_masp = od.f_masp AND dm.company_id = ${companyId}
    WHERE od.company_id = ${companyId}
      AND od.f_maddh = ANY(${arr})
      AND coalesce(dm.f_nguyenlieu, '') NOT IN ('', '0')
      AND coalesce(dm.f_m3_tc, 0) > 0
    GROUP BY dm.f_nguyenlieu, dm.f_dayy_tc
    ORDER BY dm.f_nguyenlieu, dm.f_dayy_tc
  `)) as unknown as Array<{ nguyenlieu: string; dayy_tc: number; tong_sokhoi: number }>;

  return rows;
}
