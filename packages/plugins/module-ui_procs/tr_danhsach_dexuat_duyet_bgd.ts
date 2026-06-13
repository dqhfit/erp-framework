/* Port TR_DANHSACH_DEXUAT_DUYET_BGD — Ban giám đốc duyệt 1 đề xuất.
   Nguồn: migration-plan/ui/proc-bodies/tr_danhsach_dexuat_duyet_bgd.sql

   3 phần:
   1. Tra id vị trí xét duyệt BGD: SELECT id FROM tr_nhom_xetduyet WHERE isBGD=1
      (NULL → 0). Nếu != 0:
        - tr_danhsach_dexuat: set vị trí xét duyệt (hiện+kế tiếp)=idBGD,
          trangthai_dexuat=1 (cột boolean), trangthai_dexuat2='COMPLETE'
          theo (nhom_dexuat, ma_dexuat).
        - tr_danhsach_dexuat_process: set value_xetduyet + ngay_xetduyet theo
          (nhom_dexuat, ma_dexuat, id_xetduyet=idBGD).
   2. Phân nhánh theo nhom_dexuat → cập nhật bảng nghiệp vụ tương ứng (luôn
      chạy, KHÔNG phụ thuộc idBGD — y hệt proc gốc).

   ⚠ Nhánh MUAPHOI gốc UPDATE dqt_dexuat_phoi — bảng này ĐÃ BỊ XOÁ khỏi MSSQL
   nguồn (xác minh 2026-06-13, find-tables không thấy) → bỏ qua nhánh, log
   cảnh báo. Các bảng nhánh khác đều đã migrate.

   Ghi qua procTable.updateWhere (tách cột typed/ext, version+1, updated_at).
   Bảng đang mirror → helper tự chặn tới khi cutover (như mọi proc ghi khác). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trDanhsachDexuatDuyetBgd(
  db: DB,
  companyId: string,
  args: {
    nhom_dexuat: string;
    ma_dexuat: string;
    value_xetduyet: string;
    ngay_xetduyet: string | Date;
  },
): Promise<{ updatedMain: number; updatedProcess: number; branch: string; updatedBranch: number }> {
  if (!args.nhom_dexuat) throw new Error("Thiếu nhom_dexuat");
  if (!args.ma_dexuat) throw new Error("Thiếu ma_dexuat");
  const now = new Date();

  // ── 1. Tra id vị trí xét duyệt của Ban giám đốc ──
  const nx = await procTable(db, companyId, "tr_nhom_xetduyet");
  const bgdRows = await nx.listWhere(sql`${nx.bool("isbgd")} = true`, { limit: 1 });
  const idBgd = bgdRows[0]?.id == null ? 0 : Number(bgdRows[0].id);

  let updatedMain = 0;
  let updatedProcess = 0;
  if (idBgd !== 0) {
    const dd = await procTable(db, companyId, "tr_danhsach_dexuat");
    updatedMain = await dd.updateWhere(
      {
        vitri_xetduyet: idBgd,
        vitri_xetduyet_tieptheo: idBgd,
        trangthai_dexuat: true, // proc gốc set = 1; cột kiểu boolean
        trangthai_dexuat2: "COMPLETE",
      },
      sql`${dd.text("nhom_dexuat")} = ${args.nhom_dexuat}
          AND ${dd.text("ma_dexuat")} = ${args.ma_dexuat}`,
    );

    const ddp = await procTable(db, companyId, "tr_danhsach_dexuat_process");
    updatedProcess = await ddp.updateWhere(
      { value_xetduyet: args.value_xetduyet, ngay_xetduyet: args.ngay_xetduyet },
      sql`${ddp.text("nhom_dexuat")} = ${args.nhom_dexuat}
          AND ${ddp.text("ma_dexuat")} = ${args.ma_dexuat}
          AND ${ddp.num("id_xetduyet")} = ${idBgd}`,
    );
  }

  // ── 2. Phân nhánh theo loại đề xuất ──
  const nhom = args.nhom_dexuat.toUpperCase();
  let updatedBranch = 0;

  const updateBranch = async (
    entity: string,
    patch: Record<string, unknown>,
    keyField: string,
  ): Promise<number> => {
    const t = await procTable(db, companyId, entity);
    return t.updateWhere(patch, sql`${t.text(keyField)} = ${args.ma_dexuat}`);
  };

  switch (nhom) {
    case "BANGMAU":
      updatedBranch = await updateBranch(
        "tr_dexuat_bangmau",
        { bangiamdoc_duyet: args.value_xetduyet, bangiamdoc_ngayduyet: now },
        "id",
      );
      break;
    case "DENGHITHANHTOAN":
      updatedBranch = await updateBranch(
        "tr_denghi_thanhtoan",
        { nguoiduyet: args.value_xetduyet, ngayduyet: now },
        "id",
      );
      break;
    case "DONDATHANG":
      updatedBranch = await updateBranch(
        "tr_dondathang",
        { nguoiky: args.value_xetduyet, ngayky: now },
        "maddh",
      );
      break;
    case "DONHANG":
      updatedBranch = await updateBranch(
        "tr_order",
        { bangiamdoc_duyet: args.value_xetduyet, bangiamdoc_ngayduyet: now },
        "order_number",
      );
      break;
    case "KYTHUAT":
      updatedBranch = await updateBranch(
        "tr_thaydoi_kythuat",
        { isconfirm3: true, ngayduyet3: now, bangiamdoc: args.value_xetduyet },
        "id",
      );
      break;
    case "MUAHANG":
      updatedBranch = await updateBranch(
        "tr_phieuyeucau_muahang",
        { nguoiky: args.value_xetduyet, ngayky: now },
        "id",
      );
      break;
    case "MUAPHOI":
      // Bảng dqt_dexuat_phoi đã bị xoá khỏi nguồn → nhánh chết, bỏ qua.
      console.warn(
        "[TR_DANHSACH_DEXUAT_DUYET_BGD] nhánh MUAPHOI bỏ qua: bảng dqt_dexuat_phoi không còn ở nguồn.",
      );
      break;
    case "XUATKHO":
      updatedBranch = await updateBranch(
        "tr_phieuyeucau",
        { nguoiky: args.value_xetduyet, ngayky: now },
        "id",
      );
      break;
    default:
      // Nhóm không khớp nhánh nào — proc gốc cũng không làm gì thêm.
      break;
  }

  return { updatedMain, updatedProcess, branch: nhom, updatedBranch };
}
