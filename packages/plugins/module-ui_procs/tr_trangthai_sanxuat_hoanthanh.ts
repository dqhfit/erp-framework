/* Port "Hoàn thành sản lượng" — CongDoanDController.HoanThanhAction_Execute +
   FnPhieu.SetTrangthaiSanxuat (NhapSanLuong, DQHF252). KHÔNG có proc SQL nguồn
   — viết lại nghiệp vụ C#.

   Mỗi lần công nhân bấm "Hoàn thành" tại 1 công đoạn:
     1. Tra thẻ pallet (card_no) → pallet (định mức + đơn hàng).
     2. soDaLam = Σ soluong các record cùng (pcard, congdoan hiện tại, diqua).
        soCanLam = pallet_card.soluong − soDaLam. Validate 0<soLuong<=soCanLam
        + ngày ∈ [đầu tuần (T2), hôm nay] (giờ VN).
     3. Tính sokhoi: mact='000' → sokhoi_tinhche/soluong_can; else
        card.soluong × (oday*orong*odai/1e9).
     4. Insert 2 record tr_trangthai_sanxuat:
        - GIAO: congdoan=hiện tại,  congdoantieptheo=sau
        - NHẬN: congdoan=sau,       congdoantieptheo=hiện tại
     5. Nếu soDaLam+soLuong == card.soluong → record `-IN` tương ứng
        (cùng madonhang/masp/mact + congdoan = c_location.replace('-PROD','-IN')
        + diqua) set ishoanthanh=true.
   Ghi qua procTable (đọc meta.storage.columns runtime — cột vật lý f_/ext, tự
   version/updated_at, guard mirror). 2 insert + mark trong 1 transaction. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable, rows } from "../src/proc-table";

/** Ngày VN (UTC+7) dạng yyyy-mm-dd + đầu tuần (Thứ 2). */
function vnDates(): { todayIso: string; mondayIso: string; nowStr: string } {
  const VN = 7 * 3600 * 1000;
  const now = new Date(Date.now() + VN);
  const todayIso = now.toISOString().slice(0, 10);
  const dow = now.getUTCDay(); // 0=CN..6=T7
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + diffToMon);
  return {
    todayIso,
    mondayIso: monday.toISOString().slice(0, 10),
    nowStr: now.toISOString().slice(0, 19).replace("T", " "),
  };
}

export async function trTrangthaiSanxuatHoanthanh(
  db: DB,
  companyId: string,
  args: {
    cardNo: string;
    congDoan: string; // c_location công đoạn hiện tại
    congDoanSau: string; // c_location công đoạn kế tiếp
    soLuong: number;
    oday: number;
    orong: number;
    odai: number; // quy cách thực tế (mm)
    diqua?: number; // lần làm (default 1)
    ngay?: string; // yyyy-mm-dd (default hôm nay)
    nguoitao?: string;
  },
): Promise<{
  giaoId: string;
  nhanId: string;
  soDaLam: number;
  soCanLam: number;
  hoanThanhPhieu: boolean;
}> {
  if (!args.cardNo) throw new Error("Thiếu thẻ pallet (cardNo)");
  if (!args.congDoan) throw new Error("Thiếu công đoạn hiện tại");
  if (!args.congDoanSau) throw new Error("Thiếu công đoạn kế tiếp");
  if (!(args.oday > 0 && args.orong > 0 && args.odai > 0)) {
    throw new Error("Chưa nhập quy cách thực tế (dầy/rộng/dài > 0)");
  }
  const diqua = args.diqua && args.diqua > 0 ? Math.trunc(args.diqua) : 1;
  const soLuong = Math.trunc(args.soLuong);
  if (!(soLuong > 0)) throw new Error("Số lượng phải > 0");

  // ── Ngày sản lượng phải trong tuần này ──
  const { todayIso, mondayIso, nowStr } = vnDates();
  const ngayIso = (args.ngay ?? todayIso).slice(0, 10);
  if (ngayIso < mondayIso || ngayIso > todayIso) {
    throw new Error(`Ngày sản lượng phải từ đầu tuần (${mondayIso}) đến hôm nay (${todayIso})`);
  }

  // ── Tra thẻ pallet + pallet (định mức/đơn hàng) ──
  const cardT = await procTable(db, companyId, "tr_pallet_card");
  const [card] = await cardT.listWhere(sql`${cardT.text("card_no")} = ${args.cardNo}`, {
    limit: 1,
  });
  if (!card) throw new Error(`Không tìm thấy thẻ pallet: ${args.cardNo}`);
  const cardSoluong = Number(card.soluong) || 0;
  const palletId = card.pallet_id == null ? "" : String(card.pallet_id);

  const palletT = await procTable(db, companyId, "tr_pallet");
  const [pallet] = await palletT.listWhere(sql`${palletT.text("id")} = ${palletId}`, { limit: 1 });
  if (!pallet) throw new Error(`Không tìm thấy pallet (id=${palletId}) của thẻ ${args.cardNo}`);

  const mact = String(pallet.mact ?? "");
  // sokhoi theo quy tắc nguồn
  let sokhoi: number;
  if (mact === "000") {
    const soluongCan = Number(pallet.soluong_can) || 0;
    sokhoi = soluongCan ? (Number(pallet.sokhoi_tinhche) || 0) / soluongCan : 0;
  } else {
    sokhoi = cardSoluong * ((args.oday * args.orong * args.odai) / 1e9);
  }

  // Bản ghi chung (map y hệt SetTrangthaiSanxuat) — congdoan/tieptheo set sau.
  const baseRec: Record<string, unknown> = {
    madonhang: pallet.dondathang ?? null,
    masp: pallet.mahtr ?? null,
    masp1: pallet.masp ?? null,
    mact: pallet.mact ?? null,
    tenct: pallet.tenct ?? null,
    nguyenlieu: pallet.nguyenlieu ?? null,
    dayy: pallet.dayy_tc ?? null,
    rong: pallet.rong_tc ?? null,
    dai: pallet.dai_tc ?? null,
    soluong: soLuong,
    sokhoi,
    ngaythang: ngayIso,
    ngaytao: nowStr,
    nguoitao: args.nguoitao ?? null,
    pcard: args.cardNo,
    oday: args.oday,
    orong: args.orong,
    odai: args.odai,
    diqua,
    gianguyenlieu: 0,
  };

  return db.transaction(async (tx) => {
    const tsT = await procTable(tx, companyId, "tr_trangthai_sanxuat");

    // soDaLam = Σ soluong cùng (pcard, congdoan hiện tại, diqua)
    const sumRes = rows<{ s: string | number }>(
      await tx.execute(sql`
        SELECT COALESCE(SUM(${tsT.num("soluong")}), 0) AS s
        FROM ${tsT.tbl}
        WHERE ${tsT.scope}
          AND ${tsT.text("pcard")} = ${args.cardNo}
          AND ${tsT.text("congdoan")} = ${args.congDoan}
          AND ${tsT.num("diqua")} = ${diqua}`),
    );
    const soDaLam = Number(sumRes[0]?.s) || 0;
    const soCanLam = cardSoluong - soDaLam;
    if (soLuong > soCanLam) {
      throw new Error(
        `Vượt số cần làm: nhập ${soLuong}, còn cần ${soCanLam} (đã làm ${soDaLam}/${cardSoluong})`,
      );
    }

    const giaoId = await tsT.insertRow(
      { ...baseRec, congdoan: args.congDoan, congdoantieptheo: args.congDoanSau },
      args.nguoitao ?? null,
    );
    const nhanId = await tsT.insertRow(
      { ...baseRec, congdoan: args.congDoanSau, congdoantieptheo: args.congDoan },
      args.nguoitao ?? null,
    );

    let hoanThanhPhieu = false;
    if (soDaLam + soLuong === cardSoluong) {
      const inLoc = args.congDoan.replace("-PROD", "-IN");
      const n = await tsT.updateWhere(
        { ishoanthanh: true },
        sql`${tsT.text("madonhang")} = ${String(pallet.dondathang ?? "")}
            AND ${tsT.text("masp")} = ${String(pallet.mahtr ?? "")}
            AND ${tsT.text("mact")} = ${String(pallet.mact ?? "")}
            AND ${tsT.text("congdoan")} = ${inLoc}
            AND ${tsT.num("diqua")} = ${diqua}`,
      );
      hoanThanhPhieu = n > 0;
    }

    return { giaoId, nhanId, soDaLam, soCanLam, hoanThanhPhieu };
  });
}
