/* Port TR_DINHMUC_GOVAN_SOCHE_UPDATEBYID — sửa 1 dòng định mức gỗ ván
   sơ chế theo id.
   Nguồn: migration-plan/ui/proc-bodies/tr_dinhmuc_govan_soche_updatebyid.sql
   LƯU Ý: T-SQL nhận @ngaytao/@nguoitao nhưng SET KHÔNG cập nhật 2 cột này
   (giữ thông tin tạo gốc) — giữ trong args cho khớp chữ ký, không ghi. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trDinhmucGovanSocheUpdatebyid(
  db: DB,
  companyId: string,
  args: {
    id: string;
    masp?: string | null;
    mact?: string | null;
    stt?: string | null;
    chitiet?: string | null;
    nguyenlieu?: string | null;
    dayy_sc?: number | null;
    rong_sc?: number | null;
    dai_sc?: number | null;
    soluong_sc?: number | null;
    m3_sc?: number | null;
    ghichu?: string | null;
    ngaytao?: string | null;
    nguoitao?: string | null;
    ngaysua?: string | null;
    nguoisua?: string | null;
    veneer_matchinh?: string | null;
    veneer_matphu?: string | null;
    veneer_dan_canh?: string | null;
    uv_canhngan?: number | null;
    uv_canhdai?: number | null;
    uv_matchinh?: boolean | null;
    uv_matphu?: boolean | null;
    veneer_canhngan?: number | null;
    veneer_canhdai?: number | null;
  },
): Promise<number> {
  if (!args.id) throw new Error("Thiếu id");

  const t = await procTable(db, companyId, "tr_dinhmuc_govan_soche");
  return t.updateWhere(
    {
      masp: args.masp ?? null,
      mact: args.mact ?? null,
      stt: args.stt ?? null,
      chitiet: args.chitiet ?? null,
      nguyenlieu: args.nguyenlieu ?? null,
      dayy_sc: args.dayy_sc ?? null,
      rong_sc: args.rong_sc ?? null,
      dai_sc: args.dai_sc ?? null,
      soluong_sc: args.soluong_sc ?? null,
      m3_sc: args.m3_sc ?? null,
      ghichu: args.ghichu ?? null,
      ngaysua: args.ngaysua ?? null,
      nguoisua: args.nguoisua ?? null,
      veneer_matchinh: args.veneer_matchinh ?? null,
      veneer_matphu: args.veneer_matphu ?? null,
      veneer_dan_canh: args.veneer_dan_canh ?? null,
      uv_canhngan: args.uv_canhngan ?? null,
      uv_canhdai: args.uv_canhdai ?? null,
      uv_matchinh: args.uv_matchinh ?? null,
      uv_matphu: args.uv_matphu ?? null,
      veneer_canhngan: args.veneer_canhngan ?? null,
      veneer_canhdai: args.veneer_canhdai ?? null,
    },
    sql`${t.text("id")} = ${args.id}`,
  );
}
