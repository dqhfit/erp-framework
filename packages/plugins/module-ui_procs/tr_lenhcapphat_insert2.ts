/* Port TR_LENHCAPPHAT_INSERT2 — thêm lệnh cấp phát.
   Nguồn: migration-plan/ui/proc-bodies/tr_lenhcapphat_insert2.sql
   Ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   của bảng thật, tự version/updated_at/search_tsv, guard mirror).
   Lưu ý: tên field theo field-map là dạng dính liền (lenhcapphatid,
   loaidonhang, loaicapphat, madondathang, madonhang) — args giữ shape snake
   cũ để page tham chiếu không vỡ.
   Semantic đổi: trả id uuid của row mới (id int nguồn không tồn tại). */
import type { DB } from "@erp-framework/server/db";
import { procTable } from "../src/proc-table";

export async function trLenhcapphatInsert2(
  db: DB,
  companyId: string,
  args: {
    lenh_cap_phat_id: string;
    loai_don_hang?: string | null;
    loai_cap_phat?: string | null;
    ma_don_dat_hang?: string | null;
    ma_don_hang?: string | null;
    master_code?: string | null;
    masp?: string | null;
    mavt?: string | null;
    mota?: string | null;
    quycach?: string | null;
    mausac?: string | null;
    soluong_donhang?: number | null;
    soluong?: number | null;
    soluong_daphat?: number | null;
    soluong_conlai?: number | null;
    dvt?: string | null;
    nhom?: string | null;
    nguoitao?: string | null;
    ngaytao?: Date | string | null;
    capphat?: boolean | null;
    active?: boolean | null;
    ghichu?: string | null;
    vuotdinhmuc?: boolean | null;
  },
): Promise<Array<{ id: string }>> {
  if (!args.lenh_cap_phat_id) throw new Error("Thiếu lenh_cap_phat_id");

  const t = await procTable(db, companyId, "tr_lenhcapphat");
  const id = await t.insertRow({
    lenhcapphatid: args.lenh_cap_phat_id,
    loaidonhang: args.loai_don_hang ?? null,
    loaicapphat: args.loai_cap_phat ?? null,
    madondathang: args.ma_don_dat_hang ?? null,
    madonhang: args.ma_don_hang ?? null,
    master_code: args.master_code ?? null,
    masp: args.masp ?? null,
    mavt: args.mavt ?? null,
    mota: args.mota ?? null,
    quycach: args.quycach ?? null,
    mausac: args.mausac ?? null,
    soluong_donhang: args.soluong_donhang ?? null,
    soluong: args.soluong ?? null,
    soluong_daphat: args.soluong_daphat ?? null,
    soluong_conlai: args.soluong_conlai ?? null,
    dvt: args.dvt ?? null,
    nhom: args.nhom ?? null,
    nguoitao: args.nguoitao ?? null,
    ngaytao: args.ngaytao instanceof Date ? args.ngaytao.toISOString() : (args.ngaytao ?? null),
    capphat: args.capphat ?? null,
    active: args.active ?? null,
    ghichu: args.ghichu ?? null,
    vuotdinhmuc: args.vuotdinhmuc ?? null,
  });

  return [{ id }];
}
