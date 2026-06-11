import { sql } from "drizzle-orm";
import type { DB } from "@erp-framework/server/db";

// Các kho không cần xác nhận tự động khi tạo vật tư mới
const KHO_KHONG_XAC_NHAN = ["BAO BÌ", "HÓA CHẤT", "NGŨ KIM"];

export async function trMaterialInsert2(
  db: DB,
  companyId: string,
  args: {
    idxuong?: string | null;
    mavt: string;
    tenvt?: string | null;
    tenvt_en?: string | null;
    mota?: string | null;
    quycach?: string | null;
    dayy?: string | null;
    rong?: string | null;
    dai?: string | null;
    cao?: string | null;
    dacdiem?: string | null;
    mausac?: string | null;
    dvt?: string | null;
    soluong1kg?: number | null;
    nguyenlieu?: string | null;
    nhom?: string | null;
    mancc?: string | null;
    tenncc?: string | null;
    dongia?: number | null;
    dongia_goc?: number | null;
    /** Nhận vào nhưng proc gốc comment-out, KHÔNG ghi vào bảng */
    dongia_ban?: number | null;
    loaitien?: string | null;
    hinhanh?: string | null;
    ghichu?: string | null;
    kho?: string | null;
    dobuc?: string | null;
    solop?: string | null;
    seq7?: string | null;
    seg8?: string | null;
    seg9?: string | null;
    seq10?: string | null;
    xuatxu?: string | null;
    xoa?: string | null;
    create_by?: string | null;
    create_date?: string | null;
    update_by?: string | null;
    update_date?: string | null;
    van_tieuchuan?: string | null;
    van_mat1?: string | null;
    van_mat2?: string | null;
    duongkinhtrong?: number | null;
    duongkinhngoai?: number | null;
    heren?: string | null;
    duongkinh?: string | null;
    mavt_ncc?: string | null;
  },
): Promise<Array<{ id: string }>> {
  if (!args.mavt) throw new Error("Thiếu mavt");

  // Kho BAO BÌ / HÓA CHẤT / NGŨ KIM → xacnhan = false (cần duyệt thủ công)
  const xacnhan = !KHO_KHONG_XAC_NHAN.includes(args.kho ?? "");

  const r = await db.execute<{ id: string }>(sql`
    INSERT INTO tr_material (
      id,
      company_id,
      idxuong,
      mavt,
      tenvt,
      tenvt_en,
      mota,
      quycach,
      dayy,
      rong,
      dai,
      cao,
      dacdiem,
      mausac,
      dvt,
      soluong1kg,
      nguyenlieu,
      nhom,
      mancc,
      tenncc,
      dongia,
      dongia_goc,
      loaitien,
      hinhanh,
      ghichu,
      kho,
      dobuc,
      solop,
      seq7,
      seg8,
      seg9,
      seq10,
      xuatxu,
      xoa,
      create_by,
      create_date,
      update_by,
      update_date,
      van_tieuchuan,
      van_mat1,
      van_mat2,
      duongkinhtrong,
      duongkinhngoai,
      heren,
      duongkinh,
      xacnhan,
      mavt_ncc,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      ${companyId},
      ${args.idxuong ?? null},
      ${args.mavt},
      ${args.tenvt ?? null},
      ${args.tenvt_en ?? null},
      ${args.mota ?? null},
      ${args.quycach ?? null},
      ${args.dayy ?? null},
      ${args.rong ?? null},
      ${args.dai ?? null},
      ${args.cao ?? null},
      ${args.dacdiem ?? null},
      ${args.mausac ?? null},
      ${args.dvt ?? null},
      ${args.soluong1kg ?? null},
      ${args.nguyenlieu ?? null},
      ${args.nhom ?? null},
      ${args.mancc ?? null},
      ${args.tenncc ?? null},
      ${args.dongia ?? null},
      ${args.dongia_goc ?? null},
      ${args.loaitien ?? null},
      ${args.hinhanh ?? null},
      ${args.ghichu ?? null},
      ${args.kho ?? null},
      ${args.dobuc ?? null},
      ${args.solop ?? null},
      ${args.seq7 ?? null},
      ${args.seg8 ?? null},
      ${args.seg9 ?? null},
      ${args.seq10 ?? null},
      ${args.xuatxu ?? null},
      ${args.xoa ?? null},
      ${args.create_by ?? null},
      ${args.create_date ?? null},
      ${args.update_by ?? null},
      ${args.update_date ?? null},
      ${args.van_tieuchuan ?? null},
      ${args.van_mat1 ?? null},
      ${args.van_mat2 ?? null},
      ${args.duongkinhtrong ?? null},
      ${args.duongkinhngoai ?? null},
      ${args.heren ?? null},
      ${args.duongkinh ?? null},
      ${xacnhan},
      ${args.mavt_ncc ?? null},
      now(),
      now()
    )
    RETURNING id
  `);

  // TODO: bảng tr_material_baogia chưa có trong mapping — cần xác nhận schema PG
  // tương ứng trước khi kích hoạt đoạn dưới.
  // T-SQL gốc:
  //   INSERT INTO tr_material_baogia (mact, ngaytao, nguoitao, ngaysua, nguoisua)
  //   VALUES (@mavt, @create_date, @create_by, @update_date, @update_by);

  return r as unknown as Array<{ id: string }>;
}
