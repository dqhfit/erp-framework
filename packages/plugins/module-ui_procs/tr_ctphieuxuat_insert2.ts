/* Port TR_CTPHIEUXUAT_INSERT2 — thêm chi tiết phiếu xuất.
   Nguồn: migration-plan/ui/proc-bodies/tr_ctphieuxuat_insert2.sql
   Ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   f_... hoặc ext của bảng thật, tự version/updated_at/search_tsv, guard mirror).
   ĐỔI SEMANTIC: proc gốc trả @id OUTPUT = SCOPE_IDENTITY() (int identity);
   bảng thật PG dùng PK row uuid → trả về { id: <uuid row mới> }.
   Field BatchNo của T-SQL trong field-map là "batchno" (lowercase). */
import type { DB } from "@erp-framework/server/db";
import { procTable } from "../src/proc-table";

export async function trCtphieuxuatInsert2(
  db: DB,
  companyId: string,
  args: {
    lenhcapphat?: string | null;
    phieuxuat?: string | null;
    makho?: string | null;
    mact?: string | null;
    soluong?: number | null;
    ghichu?: string | null;
    ngaytao?: string | null;
    nguoitao?: string | null;
    id_pyc_chitiet?: string | null;
    id_chitiet_dathang?: number | null;
    id_chitiet_lcp?: number | null;
    batchno?: string | null;
    id_chitiet_phieunhap?: number | null;
  },
): Promise<Array<{ id: string }>> {
  const t = await procTable(db, companyId, "tr_ctphieuxuat");
  const id = await t.insertRow({
    lenhcapphat: args.lenhcapphat ?? null,
    phieuxuat: args.phieuxuat ?? null,
    makho: args.makho ?? null,
    mact: args.mact ?? null,
    soluong: args.soluong ?? null,
    ghichu: args.ghichu ?? null,
    ngaytao: args.ngaytao ?? null,
    nguoitao: args.nguoitao ?? null,
    id_pyc_chitiet: args.id_pyc_chitiet ?? null,
    id_chitiet_dathang: args.id_chitiet_dathang ?? null,
    id_chitiet_lcp: args.id_chitiet_lcp ?? null,
    batchno: args.batchno ?? null,
    id_chitiet_phieunhap: args.id_chitiet_phieunhap ?? null,
  });

  return [{ id }];
}
