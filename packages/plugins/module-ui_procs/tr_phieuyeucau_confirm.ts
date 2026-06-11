/* Port TR_PHIEUYEUCAU_CONFIRM — duyệt phiếu yêu cầu (3 cấp).
   Nguồn: migration-plan/ui/proc-bodies/tr_phieuyeucau_confirm.sql
   Đọc/ghi qua procTable (đọc meta.storage.columns lúc runtime — đúng cột vật lý
   f_... hoặc ext của bảng thật, tự version/updated_at, guard mirror).

   Luồng:
   1. Tra sys_user_rule (field-map: username/c_menu/allowadd, lowercase):
      allowadd = 1 với c_menu = 'objDuyetPhieuYeuCau3' → ép type = 2.
   2. type 0 (trưởng bộ phận): nguoiduyet + ngayduyet + isconfirm = true.
      type 1 (phòng thu mua):  nguoiduyet2 + ngayduyet2; riêng loaidexuat =
      'XENANG': nếu cả nguoiduyet lẫn nguoiduyet2 đã có → tính tuần của ngaytao
      (thứ Hai → Chủ nhật, T-SQL DATEADD(DAY, 2 - DATEPART(WEEKDAY, ...)) với
      DATEFIRST mặc định = CN), SUM soluong các phiếu cùng nguoitao trong tuần
      join chi tiết theo phieuyeucau_id với mact = 'VDD001-0001'; tổng <= 60 →
      auto ký 'FRIDAY' + isconfirm = true.
      type 2 (ban giám đốc):   nguoiky + ngayky + isconfirm = true.
   3. JOIN 2 bảng thật tách thành 2 query (mỗi procTable có scope riêng, biểu
      thức cột không mang alias nên không join trực tiếp được):
      (a) listWhere tr_phieuyeucau theo nguoitao + tuần; (b) listWhere
      tr_phieuyeucau_chitiet theo mact + phieuyeucau_id IN (danh sách id).
   4. Câu "select ... where sophieu = '101034'" cuối proc gốc là debug leftover
      — BỎ, không port.

   PK nguồn uniqueidentifier → so sánh qua field "id" (text). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

/** Giá trị bool đọc từ listWhere có thể là true/"true"/1/"1" (ext jsonb). */
function isTruthyBool(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

/** Tuần của một mốc thời gian: thứ Hai (đầu) → Chủ nhật (cuối), dạng YYYY-MM-DD.
 *  Dựng bằng Date.UTC từ phần date của chuỗi để khỏi lệch ±1 ngày theo tz. */
function weekOf(value: unknown): { start: string; end: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""));
  if (!m) return null;
  const base = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(base.getTime())) return null;
  const dow = base.getUTCDay(); // 0 = CN ... 6 = T7
  // Trung thực với T-SQL gốc (DATEFIRST = 7, CN = 1): ngày Chủ nhật cho
  // DATEADD(2 - 1) = +1 → tuần BẮT ĐẦU từ thứ Hai KẾ TIẾP (phiếu tạo CN
  // không tự đếm vào tuần nào — quirk của proc nguồn, giữ nguyên).
  const diffToMonday = dow === 0 ? 1 : 1 - dow;
  const DAY_MS = 86_400_000;
  const monday = new Date(base.getTime() + diffToMonday * DAY_MS);
  const sunday = new Date(monday.getTime() + 6 * DAY_MS);
  return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
}

export async function trPhieuyeucauConfirm(
  db: DB,
  companyId: string,
  args: {
    id: string;
    type: number;
    nguoiduyet: string;
    ngayduyet: string;
  },
): Promise<Array<{ updated: number }>> {
  if (!args.id) throw new Error("Thiếu id");
  if (args.type == null) throw new Error("Thiếu type");
  if (!args.nguoiduyet) throw new Error("Thiếu nguoiduyet");
  if (!args.ngayduyet) throw new Error("Thiếu ngayduyet");

  const ngayduyet = new Date(args.ngayduyet).toISOString();
  let type = args.type;

  // 1. Quyền duyệt vượt cấp: sys_user_rule allowadd với menu objDuyetPhieuYeuCau3
  const tRule = await procTable(db, companyId, "sys_user_rule");
  const [rule] = await tRule.listWhere(
    sql`${tRule.text("username")} = ${args.nguoiduyet}
        AND ${tRule.text("c_menu")} = 'objDuyetPhieuYeuCau3'`,
    { limit: 1 },
  );
  if (rule && isTruthyBool(rule.allowadd)) type = 2;

  const t = await procTable(db, companyId, "tr_phieuyeucau");
  const where = sql`${t.text("id")} = ${args.id}`;

  // Đọc phiếu (loaidexuat + nguoitao + ngaytao cho nhánh XENANG)
  const [phieu] = await t.listWhere(where, { limit: 1 });
  if (!phieu) throw new Error("Không tìm thấy phiếu yêu cầu");
  const loaidexuat = phieu.loaidexuat == null ? "" : String(phieu.loaidexuat);

  if (type === 0) {
    // Trưởng bộ phận duyệt
    const updated = await t.updateWhere(
      { nguoiduyet: args.nguoiduyet, ngayduyet, isconfirm: true },
      where,
    );
    return [{ updated }];
  }

  if (type === 1) {
    // Phòng thu mua duyệt
    const updated = await t.updateWhere(
      { nguoiduyet2: args.nguoiduyet, ngayduyet2: ngayduyet },
      where,
    );

    if (loaidexuat === "XENANG") {
      // Đọc lại sau update — như EXISTS của T-SQL (nguoiduyet2 vừa được set)
      const [after] = await t.listWhere(where, { limit: 1 });
      const nguoiduyet1 = after?.nguoiduyet == null ? "" : String(after.nguoiduyet);
      const nguoiduyet2 = after?.nguoiduyet2 == null ? "" : String(after.nguoiduyet2);

      if (after && nguoiduyet1 !== "" && nguoiduyet2 !== "") {
        const nguoitao = after.nguoitao == null ? "" : String(after.nguoitao);
        const week = weekOf(after.ngaytao);

        if (week) {
          // Query 1: các phiếu của nguoitao trong tuần (so theo phần DATE của
          // ngaytao — tương đương CONVERT(DATE, ngaytao) BETWEEN ... gốc)
          const phieuTrongTuan = await t.listWhere(
            sql`${t.text("nguoitao")} = ${nguoitao}
                AND (${t.ts("ngaytao")})::date >= ${week.start}::date
                AND (${t.ts("ngaytao")})::date <= ${week.end}::date`,
          );
          const phieuIds = phieuTrongTuan
            .map((p) => (p.id == null ? "" : String(p.id)))
            .filter((v) => v !== "");

          // Query 2: chi tiết mact = 'VDD001-0001' của các phiếu đó
          let tongsl = 0;
          if (phieuIds.length > 0) {
            const tCt = await procTable(db, companyId, "tr_phieuyeucau_chitiet");
            const chitiet = await tCt.listWhere(
              sql`${tCt.text("mact")} = 'VDD001-0001'
                  AND ${tCt.text("phieuyeucau_id")} IN (${sql.join(
                    phieuIds.map((v) => sql`${v}`),
                    sql`, `,
                  )})`,
            );
            for (const ct of chitiet) {
              const n = Number(ct.soluong);
              if (Number.isFinite(n)) tongsl += n;
            }
          }

          // Tổng số lượng trong tuần <= 60 → hệ thống tự ký
          if (tongsl <= 60) {
            await t.updateWhere(
              { nguoiky: "FRIDAY", ngayky: new Date().toISOString(), isconfirm: true },
              where,
            );
          }
        }
      }
    }
    return [{ updated }];
  }

  if (type === 2) {
    // Ban giám đốc duyệt
    const updated = await t.updateWhere(
      { nguoiky: args.nguoiduyet, ngayky: ngayduyet, isconfirm: true },
      where,
    );
    return [{ updated }];
  }

  // T-SQL gốc không có nhánh nào khác — giữ no-op
  return [{ updated: 0 }];
}
