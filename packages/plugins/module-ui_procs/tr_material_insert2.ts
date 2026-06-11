/* Port TR_MATERIAL_INSERT2 — thêm vật tư + dòng theo dõi báo giá.
   Nguồn: migration-plan/ui/proc-bodies/tr_material_insert2.sql
   Ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   của bảng thật, tự version/updated_at/search_tsv, guard mirror).
   Ghi chú:
   - @dongia_ban nhận vào nhưng proc gốc comment-out cột này → KHÔNG ghi.
   - Kho BAO BÌ / HÓA CHẤT / NGŨ KIM → xacnhan = false (cần duyệt thủ công).
   - Proc gốc INSERT thêm tr_material_baogia (mact, ngaytao, nguoitao,
     ngaysua, nguoisua). Bảng này KHÔNG có trong field-map.json — vẫn đi qua
     procTable; nếu entity thiếu, runtime sẽ báo lỗi rõ ràng.
   Semantic đổi: trả id uuid của row tr_material mới (id int nguồn không tồn tại). */
import type { DB } from "@erp-framework/server/db";
import { procTable } from "../src/proc-table";

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

  // T-SQL: @xacnhan = 1 mặc định; kho đặc biệt → 0
  const xacnhan = !KHO_KHONG_XAC_NHAN.includes(args.kho ?? "");

  const t = await procTable(db, companyId, "tr_material");
  const id = await t.insertRow({
    idxuong: args.idxuong ?? null,
    mavt: args.mavt,
    tenvt: args.tenvt ?? null,
    tenvt_en: args.tenvt_en ?? null,
    mota: args.mota ?? null,
    quycach: args.quycach ?? null,
    dayy: args.dayy ?? null,
    rong: args.rong ?? null,
    dai: args.dai ?? null,
    cao: args.cao ?? null,
    dacdiem: args.dacdiem ?? null,
    mausac: args.mausac ?? null,
    dvt: args.dvt ?? null,
    soluong1kg: args.soluong1kg ?? null,
    nguyenlieu: args.nguyenlieu ?? null,
    nhom: args.nhom ?? null,
    mancc: args.mancc ?? null,
    tenncc: args.tenncc ?? null,
    dongia: args.dongia ?? null,
    dongia_goc: args.dongia_goc ?? null,
    loaitien: args.loaitien ?? null,
    hinhanh: args.hinhanh ?? null,
    ghichu: args.ghichu ?? null,
    kho: args.kho ?? null,
    dobuc: args.dobuc ?? null,
    solop: args.solop ?? null,
    seq7: args.seq7 ?? null,
    seg8: args.seg8 ?? null,
    seg9: args.seg9 ?? null,
    seq10: args.seq10 ?? null,
    xuatxu: args.xuatxu ?? null,
    xoa: args.xoa ?? null,
    create_by: args.create_by ?? null,
    create_date: args.create_date ?? null,
    update_by: args.update_by ?? null,
    update_date: args.update_date ?? null,
    van_tieuchuan: args.van_tieuchuan ?? null,
    van_mat1: args.van_mat1 ?? null,
    van_mat2: args.van_mat2 ?? null,
    duongkinhtrong: args.duongkinhtrong ?? null,
    duongkinhngoai: args.duongkinhngoai ?? null,
    heren: args.heren ?? null,
    duongkinh: args.duongkinh ?? null,
    xacnhan,
    mavt_ncc: args.mavt_ncc ?? null,
  });

  // T-SQL gốc: INSERT tr_material_baogia (mact, ngaytao, nguoitao, ngaysua, nguoisua)
  const tBaogia = await procTable(db, companyId, "tr_material_baogia");
  await tBaogia.insertRow({
    mact: args.mavt,
    ngaytao: args.create_date ?? null,
    nguoitao: args.create_by ?? null,
    ngaysua: args.update_date ?? null,
    nguoisua: args.update_by ?? null,
  });

  return [{ id }];
}
