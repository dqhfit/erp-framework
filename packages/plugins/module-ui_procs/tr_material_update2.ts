/* Port TR_MATERIAL_UPDATE2 — cập nhật vật tư theo mavt. Theo proc gốc:
   - @idxuong nhận nhưng KHÔNG nằm trong SET (không ghi).
   - dongia_ban / xacnhan / nguoixacnhan / ngayxacnhan bị comment-out
     ở nguồn → không ghi.
   - mavt_ncc có ở MSSQL nhưng CHƯA có field trên entity tr_material
     (manifest thiếu) → tạm bỏ; TODO: thêm field mavt_ncc vào entity
     rồi bổ sung vào patch.
   Nguồn: proc-bodies/tr_material_update2.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trMaterialUpdate2(
  db: DB,
  companyId: string,
  args: {
    idxuong?: string | null; // không ghi — xem ghi chú
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
    dongia_ban?: number | null; // không ghi (comment-out ở nguồn)
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
    update_by?: string | null;
    update_date?: string | null;
    van_tieuchuan?: string | null;
    van_mat1?: string | null;
    van_mat2?: string | null;
    duongkinhtrong?: number | null;
    duongkinhngoai?: number | null;
    heren?: string | null;
    duongkinh?: string | null;
    id_xuatxu?: string | null;
    mavt_ncc?: string | null; // chưa ghi — entity thiếu field (TODO)
  },
): Promise<Array<{ updated: number }>> {
  if (!args.mavt) throw new Error("Thiếu mavt");

  const t = await procTable(db, companyId, "tr_material");
  const updated = await t.updateWhere(
    {
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
      update_by: args.update_by ?? null,
      update_date: args.update_date ?? null,
      van_mat1: args.van_mat1 ?? null,
      van_mat2: args.van_mat2 ?? null,
      van_tieuchuan: args.van_tieuchuan ?? null,
      duongkinhtrong: args.duongkinhtrong ?? null,
      duongkinhngoai: args.duongkinhngoai ?? null,
      heren: args.heren ?? null,
      duongkinh: args.duongkinh ?? null,
      id_xuatxu: args.id_xuatxu ?? null,
    },
    sql`${t.text("mavt")} = ${args.mavt}`,
  );
  return [{ updated }];
}
