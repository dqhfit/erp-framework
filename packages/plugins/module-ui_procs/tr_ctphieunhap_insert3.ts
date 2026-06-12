/* Port TR_CTPHIEUNHAP_INSERT3 — thêm chi tiết phiếu nhập (chỉ khi
   slnhap + soluong_du > 0). Trả uuid row mới hoặc [] nếu không insert.
   Field batchno/fscid/nhomnguyenlieu/malonguyenlieu2 lowercase theo entity.
   Nguồn: proc-bodies/tr_ctphieunhap_insert3.sql */
import type { DB } from "@erp-framework/server/db";
import { procTable } from "../src/proc-table";

export async function trCtphieunhapInsert3(
  db: DB,
  companyId: string,
  args: {
    id_dathang?: string | null;
    sopn: string;
    mavt: string;
    slnhap: number;
    soluong_du?: number | null;
    ghichu?: string | null;
    ngaynhap?: string | null;
    nguoinhap?: string | null;
    idchitiet?: string | null;
    gianhap?: number | null;
    tigia?: number | null;
    batchno?: string | null;
    fscid?: number | null;
    nhomnguyenlieu?: number | null;
    malonguyenlieu2?: string | null;
    loaitien?: string | null;
  },
): Promise<Array<{ id: string }>> {
  if (!args.sopn) throw new Error("Thiếu sopn");
  if (!args.mavt) throw new Error("Thiếu mavt");

  // Proc gốc: IF @slnhap + @soluong_du > 0 mới insert
  const total = (args.slnhap ?? 0) + (args.soluong_du ?? 0);
  if (!(total > 0)) return [];

  const t = await procTable(db, companyId, "tr_ctphieunhap");
  const id = await t.insertRow({
    id_dathang: args.id_dathang ?? null,
    sopn: args.sopn,
    mavt: args.mavt,
    slnhap: args.slnhap ?? null,
    soluong_du: args.soluong_du ?? null,
    ghichu: args.ghichu ?? null,
    ngaynhap: args.ngaynhap ?? null,
    nguoinhap: args.nguoinhap ?? null,
    idchitiet: args.idchitiet ?? null,
    gianhap: args.gianhap ?? null,
    tigia: args.tigia ?? null,
    batchno: args.batchno ?? null,
    fscid: args.fscid ?? null,
    nhomnguyenlieu: args.nhomnguyenlieu ?? null,
    malonguyenlieu2: args.malonguyenlieu2 ?? null,
    loaitien: args.loaitien ?? null,
  });
  return [{ id }];
}
