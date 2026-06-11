/* Port TR_PHIEUXUAT_INSERT2 — thêm phiếu xuất kho.
   Nguồn: migration-plan/ui/proc-bodies/tr_phieuxuat_insert2.sql
   Ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   của bảng thật, tự version/updated_at/search_tsv, guard mirror).
   Lưu ý: cột nguồn IsXuat / RefType → field-map là isxuat / reftype
   (lowercase). @IsXuat bit = 1 → default true khi không truyền.
   Semantic đổi: @id OUTPUT int (SCOPE_IDENTITY) của nguồn không tồn tại cho
   row mới — trả id uuid của row mới từ insertRow. */
import type { DB } from "@erp-framework/server/db";
import { procTable } from "../src/proc-table";

export async function trPhieuxuatInsert2(
  db: DB,
  companyId: string,
  args: {
    sopx: string;
    loaiphieu: number;
    lenhcapphat: string;
    donhang: string;
    makho: string;
    nguoinhan: string;
    ghichu: string;
    nguoitao: string;
    ngaytao: string;
    active: boolean;
    nguoixacnhan?: string | null;
    ngayxacnhan?: string | null;
    xacnhan?: boolean | null;
    // @IsXuat bit = 1 trong T-SQL — default true nếu không truyền
    is_xuat?: boolean | null;
    ngayxuat?: string | null;
    reftype?: number | null;
    phieuyeucau?: string | null;
    maddh?: string | null;
    mucdich?: number | null;
  },
): Promise<Array<{ id: string }>> {
  if (!args.sopx) throw new Error("Thiếu sopx");

  const t = await procTable(db, companyId, "tr_phieuxuat");
  const id = await t.insertRow({
    sopx: args.sopx,
    loaiphieu: args.loaiphieu,
    lenhcapphat: args.lenhcapphat,
    donhang: args.donhang,
    makho: args.makho,
    nguoinhan: args.nguoinhan,
    ghichu: args.ghichu,
    nguoitao: args.nguoitao,
    ngaytao: args.ngaytao,
    active: args.active,
    nguoixacnhan: args.nguoixacnhan ?? null,
    ngayxacnhan: args.ngayxacnhan ?? null,
    xacnhan: args.xacnhan ?? null,
    isxuat: args.is_xuat ?? true,
    ngayxuat: args.ngayxuat ?? null,
    reftype: args.reftype ?? null,
    phieuyeucau: args.phieuyeucau ?? null,
    maddh: args.maddh ?? null,
    mucdich: args.mucdich ?? null,
  });

  return [{ id }];
}
