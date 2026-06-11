import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

export async function trLenhcapphatSumbymact(
  db: DB,
  companyId: string,
  args: {
    lenh_cap_phat_id: string;
  },
): Promise<
  Array<{
    lenh_cap_phat_id: string;
    loai_don_hang: string | null;
    loai_cap_phat: string | null;
    ma_don_hang: string | null;
    mavt: string | null;
    mota: string | null;
    quycach: string | null;
    mausac: string | null;
    soluong: number;
    dvt: string | null;
    ghichu: string | null;
    nhom: string | null;
  }>
> {
  if (!args.lenh_cap_phat_id) throw new Error("Thiếu lenh_cap_phat_id");

  const r = await db.execute<{
    lenh_cap_phat_id: string;
    loai_don_hang: string | null;
    loai_cap_phat: string | null;
    ma_don_hang: string | null;
    mavt: string | null;
    mota: string | null;
    quycach: string | null;
    mausac: string | null;
    soluong: number;
    dvt: string | null;
    ghichu: string | null;
    nhom: string | null;
  }>(sql`
    SELECT
      a.lenhcapphatid                                                          AS lenh_cap_phat_id,
      a.loaidonhang                                                            AS loai_don_hang,
      a.loaicapphat                                                            AS loai_cap_phat,
      CASE
        WHEN a.madondathang = '' OR a.madondathang IS NULL THEN a.madonhang
        ELSE a.madondathang
      END                                                                      AS ma_don_hang,
      a.mavt,
      b.mota,
      b.quycach,
      b.mausac,
      SUM(a.soluong)                                                           AS soluong,
      b.dvt,
      a.ghichu,
      b.nhom
    FROM tr_lenhcapphat a
    -- TODO: tr_material chưa có trong mapping được cung cấp — giả định BẢNG THẬT PG
    -- cùng tên (tr_material). Cần xác nhận: (1) bảng có tồn tại không,
    -- (2) có cột company_id không (nếu có thì thêm AND b.company_id = ${companyId}),
    -- (3) soft-delete dùng deleted_at hay vẫn giữ cột xoa kiểu text.
    JOIN tr_material b
      ON b.mavt = a.mavt
      -- ISNULL(b.xoa, 'N') = 'N': bản ghi chưa bị xóa (cột xoa kiểu text)
      AND (b.xoa IS NULL OR b.xoa = 'N')
    WHERE a.company_id = ${companyId}
      AND a.deleted_at IS NULL
      AND a.lenhcapphatid = ${args.lenh_cap_phat_id}
      AND a.active = true
    GROUP BY
      a.lenhcapphatid,
      a.loaidonhang,
      a.loaicapphat,
      CASE
        WHEN a.madondathang = '' OR a.madondathang IS NULL THEN a.madonhang
        ELSE a.madondathang
      END,
      a.mavt,
      b.mota,
      b.quycach,
      b.mausac,
      b.dvt,
      a.ghichu,
      b.nhom
    HAVING SUM(a.soluong) > 0
    ORDER BY a.mavt
  `);

  return r as unknown as Array<{
    lenh_cap_phat_id: string;
    loai_don_hang: string | null;
    loai_cap_phat: string | null;
    ma_don_hang: string | null;
    mavt: string | null;
    mota: string | null;
    quycach: string | null;
    mausac: string | null;
    soluong: number;
    dvt: string | null;
    ghichu: string | null;
    nhom: string | null;
  }>;
}
