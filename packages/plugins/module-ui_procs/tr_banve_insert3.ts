/* Port TR_BANVE_INSERT3 — thêm bản vẽ, đồng thời đánh dấu cờ "đã có bản vẽ"
   trên sản phẩm theo phân loại:
     'Bản vẽ kỹ thuật'  → tr_sanpham.isbvkt = true
     'Bản vẽ đóng gói'  → tr_sanpham.isbvdg = true
     'Bản vẽ AI'        → tr_sanpham.isbvai = true
   Nguồn: migration-plan/ui/proc-bodies/tr_banve_insert3.sql
   Ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   f_... hoặc ext của bảng thật, tự version/updated_at/search_tsv, guard mirror). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

export async function trBanveInsert3(
  db: DB,
  companyId: string,
  args: {
    masp: string;
    tensp?: string | null;
    khachhang?: string | null;
    hehang?: string | null;
    filepath?: string | null;
    seq1?: string | null;
    seq2?: string | null;
    banve_donggoi?: boolean | null;
    banve_govan?: boolean | null;
    phanloai?: string | null;
    create_by?: string | null;
    create_date?: string | null;
    update_by?: string | null;
    update_date?: string | null;
    active?: boolean | null;
  },
): Promise<Array<{ id: string }>> {
  if (!args.masp) throw new Error("Thiếu masp");

  const t = await procTable(db, companyId, "tr_banve");
  const id = await t.insertRow({
    masp: args.masp,
    tensp: args.tensp ?? null,
    khachhang: args.khachhang ?? null,
    hehang: args.hehang ?? null,
    filepath: args.filepath ?? null,
    seq1: args.seq1 ?? null,
    seq2: args.seq2 ?? null,
    banve_donggoi: args.banve_donggoi ?? null,
    banve_govan: args.banve_govan ?? null,
    phanloai: args.phanloai ?? null,
    create_by: args.create_by ?? null,
    create_date: args.create_date ?? null,
    update_by: args.update_by ?? null,
    update_date: args.update_date ?? null,
    active: args.active ?? null,
  });

  // Đánh dấu sản phẩm đã có bản vẽ theo phân loại (IF/ELSE IF gốc)
  const flagByPhanloai: Record<string, string> = {
    "Bản vẽ kỹ thuật": "isbvkt",
    "Bản vẽ đóng gói": "isbvdg",
    "Bản vẽ AI": "isbvai",
  };
  const flag = args.phanloai ? flagByPhanloai[args.phanloai] : undefined;
  if (flag) {
    const sp = await procTable(db, companyId, "tr_sanpham");
    await sp.updateWhere({ [flag]: true }, sql`${sp.text("masp")} = ${args.masp}`);
  }

  return [{ id }];
}
