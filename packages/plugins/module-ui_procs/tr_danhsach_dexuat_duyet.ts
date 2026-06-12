/* Port TR_DANHSACH_DEXUAT_DUYET — duyệt đề xuất theo quy trình xét duyệt
   nhiều cấp (vị trí hiện tại → vị trí tiếp theo → vị trí kết thúc).
   Nguồn: migration-plan/ui/proc-bodies/tr_danhsach_dexuat_duyet.sql

   Đọc/ghi qua procTable (mapping cột vật lý từ meta.storage lúc runtime):
   - tr_danhsach_dexuat        → lấy vitri_xetduyet / _tieptheo / _ketthuc,
                                 update trạng thái duyệt.
   - tr_danhsach_xetduyet_user → gate: user phải thuộc nhóm xét duyệt của
                                 vị trí hiện tại, không thì NO-OP (như T-SQL:
                                 IF EXISTS bao toàn bộ thân proc).
   - tr_quytrinh_xetduyet      → tra id_xetduyet_next cho bước kế tiếp.
   - tr_danhsach_dexuat_process → ghi nhận người + ngày duyệt của bước
                                 hiện tại.
   Semantics NULL của T-SQL được giữ: không tìm thấy row đề xuất →
   vitri_hientai NULL → EXISTS không match → no-op; quy trình không có
   row next → vitri_xetduyet_tieptheo set NULL (biến T-SQL giữ NULL,
   IF NULL = 0 là false).
   trangthai_dexuat nguồn là bit → entity import kiểu boolean → set true.
   Khối comment cuối proc gốc (-- DECLARE @TEMP ...) đã bị vô hiệu từ
   nguồn — không port. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trDanhsachDexuatDuyet(
  db: DB,
  companyId: string,
  args: {
    nhom_dexuat: string;
    ma_dexuat: string;
    value_xetduyet: string;
    ngay_xetduyet: string;
  },
): Promise<Array<{ updated: number }>> {
  if (!args.nhom_dexuat) throw new Error("Thiếu nhom_dexuat");
  if (!args.ma_dexuat) throw new Error("Thiếu ma_dexuat");
  if (!args.value_xetduyet) throw new Error("Thiếu value_xetduyet");
  if (!args.ngay_xetduyet) throw new Error("Thiếu ngay_xetduyet");

  const ngayXetduyet = new Date(args.ngay_xetduyet).toISOString();
  const asNum = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

  // Bước 1: lấy vị trí xét duyệt hiện tại / tiếp theo / kết thúc của đề xuất
  const dexuat = await procTable(db, companyId, "tr_danhsach_dexuat");
  const whereDexuat = sql`${dexuat.text("nhom_dexuat")} = ${args.nhom_dexuat} AND ${dexuat.text("ma_dexuat")} = ${args.ma_dexuat}`;
  const [row] = await dexuat.listWhere(whereDexuat, { limit: 1 });
  const vitriHientai = asNum(row?.vitri_xetduyet);
  const vitriTieptheo = asNum(row?.vitri_xetduyet_tieptheo);
  const vitriKetthuc = asNum(row?.vitri_xetduyet_ketthuc);

  // Không có đề xuất hoặc vitri_xetduyet NULL: T-SQL EXISTS so sánh với NULL
  // → không match → toàn proc no-op.
  if (vitriHientai == null) return [{ updated: 0 }];

  // Bước 2: gate quyền — user phải nằm trong nhóm xét duyệt của vị trí hiện tại
  const xetduyetUser = await procTable(db, companyId, "tr_danhsach_xetduyet_user");
  const [allowed] = await xetduyetUser.listWhere(
    sql`${xetduyetUser.text("username")} = ${args.value_xetduyet} AND ${xetduyetUser.num("id_nhom_xetduyet")} = ${vitriHientai}`,
    { limit: 1 },
  );
  if (!allowed) return [{ updated: 0 }];

  let updated = 0;

  if (vitriKetthuc != null && vitriHientai === vitriKetthuc) {
    // Bước 3a: đang ở vị trí kết thúc → hoàn tất duyệt
    updated += await dexuat.updateWhere(
      { trangthai_dexuat: true, trangthai_dexuat2: "COMPLETE" },
      whereDexuat,
    );
  } else {
    // Bước 3b: chuyển sang bước kế tiếp theo quy trình.
    // T-SQL: SELECT id_xetduyet_next vào biến — không có row thì biến giữ
    // NULL (IF NULL = 0 là false → không gán lại) → tieptheo mới = NULL.
    let vitriTieptheo1: number | null = null;
    if (vitriTieptheo != null) {
      const quytrinh = await procTable(db, companyId, "tr_quytrinh_xetduyet");
      const [qt] = await quytrinh.listWhere(
        sql`${quytrinh.text("nhom_dexuat")} = ${args.nhom_dexuat} AND ${quytrinh.num("id_xetduyet")} = ${vitriTieptheo}`,
        { limit: 1 },
      );
      vitriTieptheo1 = asNum(qt?.id_xetduyet_next);
      if (vitriTieptheo1 === 0) vitriTieptheo1 = vitriTieptheo;
    }
    updated += await dexuat.updateWhere(
      {
        vitri_xetduyet: vitriTieptheo,
        vitri_xetduyet_tieptheo: vitriTieptheo1,
        trangthai_dexuat2: "PROCESS",
      },
      whereDexuat,
    );
  }

  // Bước 4: ghi nhận người + ngày duyệt vào dòng process của vị trí hiện tại
  const process = await procTable(db, companyId, "tr_danhsach_dexuat_process");
  updated += await process.updateWhere(
    { value_xetduyet: args.value_xetduyet, ngay_xetduyet: ngayXetduyet },
    sql`${process.text("nhom_dexuat")} = ${args.nhom_dexuat} AND ${process.text("ma_dexuat")} = ${args.ma_dexuat} AND ${process.num("id_xetduyet")} = ${vitriHientai}`,
  );

  return [{ updated }];
}
