/* Tra thông tin thẻ pallet cho màn NHẬP sản lượng (preview trước khi Hoàn
   thành). Read-only. Tra card_no → pallet (đơn hàng + định mức) + soDaLam tại
   1 công đoạn + diqua + gợi ý công đoạn sau (c_nextloc). Đi kèm
   trTrangthaiSanxuatHoanthanh (phase 2). Gọi qua procedures.invoke. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable, rows } from "../src/proc-table";

export async function trTrangthaiSanxuatCardInfo(
  db: DB,
  companyId: string,
  args: { cardNo: string; congDoan?: string; diqua?: number },
): Promise<Record<string, unknown>> {
  if (!args.cardNo) return { found: false };

  const cardT = await procTable(db, companyId, "tr_pallet_card");
  const [card] = await cardT.listWhere(sql`${cardT.text("card_no")} = ${args.cardNo}`, {
    limit: 1,
  });
  if (!card) return { found: false, message: `Không tìm thấy thẻ: ${args.cardNo}` };
  const cardSoluong = Number(card.soluong) || 0;
  const palletId = card.pallet_id == null ? "" : String(card.pallet_id);

  const palletT = await procTable(db, companyId, "tr_pallet");
  const [pallet] = await palletT.listWhere(sql`${palletT.text("id")} = ${palletId}`, { limit: 1 });
  if (!pallet) return { found: false, message: `Không tìm thấy pallet (id=${palletId})` };

  // soDaLam tại công đoạn hiện tại + diqua (nếu truyền)
  let soDaLam = 0;
  if (args.congDoan) {
    const diqua = args.diqua && args.diqua > 0 ? Math.trunc(args.diqua) : 1;
    const tsT = await procTable(db, companyId, "tr_trangthai_sanxuat");
    const sumRes = rows<{ s: string | number }>(
      await db.execute(sql`
        SELECT COALESCE(SUM(${tsT.num("soluong")}), 0) AS s
        FROM ${tsT.tbl}
        WHERE ${tsT.scope}
          AND ${tsT.text("pcard")} = ${args.cardNo}
          AND ${tsT.text("congdoan")} = ${args.congDoan}
          AND ${tsT.num("diqua")} = ${diqua}`),
    );
    soDaLam = Number(sumRes[0]?.s) || 0;
  }

  // Gợi ý công đoạn sau = c_nextloc của công đoạn hiện tại
  let congDoanSau = "";
  if (args.congDoan) {
    const locT = await procTable(db, companyId, "trtb_m_location");
    const [loc] = await locT.listWhere(sql`${locT.text("c_location")} = ${args.congDoan}`, {
      limit: 1,
    });
    congDoanSau = loc?.c_nextloc ? String(loc.c_nextloc) : "";
  }

  return {
    found: true,
    cardNo: args.cardNo,
    soluong: cardSoluong,
    dondathang: pallet.dondathang ?? null,
    masp: pallet.mahtr ?? null,
    masp1: pallet.masp ?? null,
    mact: pallet.mact ?? null,
    tenct: pallet.tenct ?? null,
    nguyenlieu: pallet.nguyenlieu ?? null,
    dayy_tc: pallet.dayy_tc ?? null,
    rong_tc: pallet.rong_tc ?? null,
    dai_tc: pallet.dai_tc ?? null,
    soDaLam,
    soCanLam: cardSoluong - soDaLam,
    congDoanSau,
  };
}
