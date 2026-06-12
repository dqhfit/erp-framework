/* Port TR_DENGHI_THANHTOAN_HUYDUYET — huỷ duyệt đề nghị thanh toán:
   type 0 (trưởng BP): clear truongbophan + ngayduyet2; type 1 (BGĐ):
   clear nguoiduyet + ngayduyet; cả 2 set ngayhuyduyet + lydohuyduyet +
   active=false. Sau đó nếu có chứng từ → trừ lùi tiền tạm ứng (loại 1)
   hoặc tiền thanh toán (loại 2) trên tr_dondathang + ispayment=false.
   Nguồn: proc-bodies/tr_denghi_thanhtoan_huyduyet.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable, rows } from "../src/proc-table";

export async function trDenghiThanhtoanHuyduyet(
  db: DB,
  companyId: string,
  args: { id: string; type: number; lydo?: string | null },
): Promise<Array<{ updated: number; dondathang_updated: number }>> {
  if (!args.id) throw new Error("Thiếu id");
  if (args.type == null) throw new Error("Thiếu type");

  const t = await procTable(db, companyId, "tr_denghi_thanhtoan");
  const where = sql`${t.text("id")} = ${args.id}`;
  const now = new Date().toISOString();

  let updated = 0;
  if (args.type === 0) {
    updated = await t.updateWhere(
      {
        truongbophan: null,
        ngayduyet2: null,
        ngayhuyduyet: now,
        lydohuyduyet: args.lydo ?? null,
        active: false,
      },
      where,
    );
  } else if (args.type === 1) {
    updated = await t.updateWhere(
      {
        nguoiduyet: null,
        ngayduyet: null,
        ngayhuyduyet: now,
        lydohuyduyet: args.lydo ?? null,
        active: false,
      },
      where,
    );
  }

  // Đọc lại loaithanhtoan/chungtu/sotien — lưu ý active vừa set false nên
  // KHÔNG dùng listWhere (scope deleted_at thôi, active là field thường — OK).
  const [denghi] = await t.listWhere(where, { limit: 1 });
  let dondathangUpdated = 0;
  const chungtu = denghi?.chungtu == null ? "" : String(denghi.chungtu);
  if (denghi && chungtu.length > 0) {
    const loai = Number(denghi.loaithanhtoan);
    const sotien = Number(denghi.sotien) || 0;
    const tDdh = await procTable(db, companyId, "tr_dondathang");
    const fieldTien = loai === 1 ? "tientamung" : loai === 2 ? "tienthanhtoan" : null;
    if (fieldTien) {
      // Trừ lùi tiền: cần biểu thức cột — đọc giá trị hiện tại rồi update
      // (atomic tương đối; proc gốc cũng không khoá).
      const res = await db.execute(
        sql`SELECT ${tDdh.num(fieldTien)} AS tien FROM ${tDdh.tbl}
            WHERE ${tDdh.scope} AND ${tDdh.text("maddh")} = ${chungtu} LIMIT 1`,
      );
      const [row] = rows<{ tien: unknown }>(res);
      if (row) {
        const current = Number(row.tien) || 0;
        dondathangUpdated = await tDdh.updateWhere(
          { [fieldTien]: current - sotien, ispayment: false },
          sql`${tDdh.text("maddh")} = ${chungtu}`,
        );
      }
    }
  }

  return [{ updated, dondathang_updated: dondathangUpdated }];
}
