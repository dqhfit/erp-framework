/* Port TR_TINHGIA_NGUYENLIEU — tính đơn giá nguyên liệu của 1 đơn hàng:
   đơn giá = tổng thành tiền quy VND / tổng số khối.
   Nguồn: migration-plan/ui/proc-bodies/tr_tinhgia_nguyenlieu.sql

   4 bảng thật → KHÔNG join 1 câu (biểu thức procTable không mang alias):
   tách từng query + ghép trong JS (batch-stitch), giữ đúng ngữ nghĩa
   chuỗi INNER JOIN gốc:
     A bg_donhang  JOIN  B bg_donhang_chitiet ON sophieu
     JOIN C tr_dexuat_phoi ON A.id_dexuat = C.id (CHARINDEX @donhang IN C.donhang)
     JOIN D tr_dexuat_phoi_chitiet ON D.dexuat_id = C.id
   LƯU Ý fan-out: JOIN D nhân bản mỗi cặp (A,B) theo SỐ DÒNG chi tiết đề
   xuất của C → SUM gốc bị nhân theo count(D). Giữ nguyên hành vi đó
   (nhân hệ số count(D) trong JS) để trung thực với proc nguồn.

   CHÚ Ý: bg_donhang + bg_donhang_chitiet KHÔNG có trong field-map (chưa
   migrate sang PG) — proc sẽ throw 'entity không tồn tại' khi gọi cho tới
   khi 2 bảng được migrate; tên field dùng theo T-SQL gốc lowercase
   (sophieu/id_dexuat/tigia, sophieu/sokhoi/thanhtien). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable, rows } from "../src/proc-table";

export async function trTinhgiaNguyenlieu(
  db: DB,
  companyId: string,
  args: {
    donhang: string;
  },
): Promise<Array<{ dongia_nguyen_lieu: number }>> {
  if (!args.donhang) throw new Error("Thiếu donhang");

  // Bước 1: C — phiếu đề xuất phôi có donhang chứa @donhang
  // (CHARINDEX(@donhang, C.donhang) > 0 → POSITION ... > 0)
  const c = await procTable(db, companyId, "tr_dexuat_phoi");
  const cRows = await c.listWhere(sql`POSITION(${args.donhang} IN ${c.text("donhang")}) > 0`);
  const cIds = [...new Set(cRows.map((r) => r.id).filter((v): v is string => v != null))];
  if (cIds.length === 0) return [{ dongia_nguyen_lieu: 0 }];
  const cIdList = sql.join(
    cIds.map((v) => sql`${String(v)}`),
    sql`, `,
  );

  // Bước 2: D — đếm số dòng chi tiết per phiếu đề xuất (hệ số fan-out của JOIN D)
  const d = await procTable(db, companyId, "tr_dexuat_phoi_chitiet");
  const dRes = await db.execute(sql`
    SELECT ${d.text("dexuat_id")} AS dexuat_id, COUNT(*) AS n
    FROM ${d.tbl}
    WHERE ${d.scope} AND ${d.text("dexuat_id")} IN (${cIdList})
    GROUP BY ${d.text("dexuat_id")}
  `);
  const dCount = new Map<string, number>();
  for (const r of rows<{ dexuat_id: string; n: unknown }>(dRes)) {
    dCount.set(String(r.dexuat_id), Number(r.n ?? 0));
  }

  // Bước 3: A — bg_donhang theo id_dexuat (INNER JOIN: phiếu không có chi
  // tiết đề xuất nào → loại). FAIL-FAST: throw nếu bg_donhang chưa migrate.
  const a = await procTable(db, companyId, "bg_donhang");
  const aRows = await a.listWhere(sql`${a.text("id_dexuat")} IN (${cIdList})`);
  const aLive = aRows.filter(
    (r) => r.id_dexuat != null && (dCount.get(String(r.id_dexuat)) ?? 0) > 0,
  );
  if (aLive.length === 0) return [{ dongia_nguyen_lieu: 0 }];

  // Bước 4: B — bg_donhang_chitiet: tổng sokhoi + thanhtien per sophieu.
  // FAIL-FAST: throw nếu bg_donhang_chitiet chưa migrate.
  const sophieus = [
    ...new Set(
      aLive
        .map((r) => r.sophieu)
        .filter((v): v is string => v != null)
        .map(String),
    ),
  ];
  if (sophieus.length === 0) return [{ dongia_nguyen_lieu: 0 }];
  const b = await procTable(db, companyId, "bg_donhang_chitiet");
  const bRes = await db.execute(sql`
    SELECT
      ${b.text("sophieu")} AS sophieu,
      SUM(${b.num("sokhoi")}) AS sokhoi,
      SUM(${b.num("thanhtien")}) AS thanhtien
    FROM ${b.tbl}
    WHERE ${b.scope} AND ${b.text("sophieu")} IN (${sql.join(
      sophieus.map((v) => sql`${v}`),
      sql`, `,
    )})
    GROUP BY ${b.text("sophieu")}
  `);
  const bBySophieu = new Map<string, { sokhoi: number; thanhtien: number }>();
  for (const r of rows<{ sophieu: string; sokhoi: unknown; thanhtien: unknown }>(bRes)) {
    bBySophieu.set(String(r.sophieu), {
      sokhoi: Number(r.sokhoi ?? 0),
      thanhtien: Number(r.thanhtien ?? 0),
    });
  }

  // Ghép: mỗi dòng A nhân tổng B của sophieu nó với hệ số count(D) của
  // phiếu đề xuất tương ứng; thành tiền quy VND nhân tỉ giá của A.
  let sokhoi = 0;
  let thanhtienVnd = 0;
  for (const ar of aLive) {
    const bSum = ar.sophieu == null ? undefined : bBySophieu.get(String(ar.sophieu));
    if (!bSum) continue; // INNER JOIN B: không có chi tiết → loại
    const mult = dCount.get(String(ar.id_dexuat)) ?? 0;
    const tigia = Number(ar.tigia ?? 0);
    sokhoi += bSum.sokhoi * mult;
    thanhtienVnd += bSum.thanhtien * tigia * mult;
  }

  // IIF(@sokhoi <= 0, 0, @thanhtien_vnd / @sokhoi)
  const dongia = sokhoi <= 0 ? 0 : thanhtienVnd / sokhoi;
  return [{ dongia_nguyen_lieu: dongia }];
}
