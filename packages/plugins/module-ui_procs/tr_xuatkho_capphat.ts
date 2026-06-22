/* Orchestration "Cấp phát" (xuất kho theo lệnh cấp phát) — gộp luồng nút
   bbiCapPhat của frmXuatKhoLenhCapPhat. Không phải 1 proc nguồn đơn lẻ mà
   ghép các proc gốc theo đúng thứ tự WinForm gọi:
     1) TR_PHIEUXUAT_NEWID    — sinh số phiếu xuất (sopx)
     2) TR_PHIEUXUAT_INSERT2  — header phiếu xuất
     3) TR_CTPHIEUXUAT_INSERT2— chi tiết phiếu (1 dòng / 1 vật tư)
     4) TR_LENHCAPPHAT_Update — cộng dồn soluong_daphat của dòng LCP
     5) TR_TONKHO_CHITIET_XUAT— trừ tồn FIFO theo mã vật tư
   Bodies: migration-plan/ui/proc-bodies/tr_phieuxuat_newid.sql,
   tr_phieuxuat_insert2.sql, tr_ctphieuxuat_insert2.sql,
   tr_lenhcapphat_update.sql, tr_tonkho_chitiet_xuat.sql

   Đầu vào tối giản: line_uuid = id bản ghi (uuid) dòng LCP đang chọn trên
   list (state "sel"). Proc TỰ đọc dòng để lấy lenhcapphatid/mavt/soluong
   _conlai/id(int)/madondathang — page khỏi phải emit từng field. soluong
   bỏ trống = cấp phát TRỌN số còn lại của dòng.

   GIỚI HẠN có chủ đích (ghi rõ để khỏi nhầm là faithful 100%):
   - Trừ tồn dùng bản FIFO TR_TONKHO_CHITIET_XUAT (theo mavt toàn kho,
     KHÔNG lọc makho) — đúng như nút "Cấp phát" tổng; bản theo kệ (XUAT2)
     không dùng ở đây.
   - makho chỉ ghi lên phiếu (thuộc tính chứng từ), KHÔNG ảnh hưởng trừ
     tồn → để optional; trang chưa có picker kho thì truyền null.
   - loaiphieu để optional (nguồn WinForm set hằng theo ngữ cảnh, không có
     trong proc body) — null nếu không truyền.
   Bọc db.transaction: lỗi giữa chừng (vd entity còn mirror) → rollback,
   không để phiếu mồ côi / trừ tồn lệch. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));
const ddMMyy = (d: Date): string =>
  pad2(d.getDate()) + pad2(d.getMonth() + 1) + pad2(d.getFullYear() % 100);

export async function trXuatkhoCapphat(
  db: DB,
  companyId: string,
  args: {
    /** id bản ghi (uuid) của DÒNG lệnh cấp phát đang chọn (page state "sel"). */
    line_uuid: string;
    nguoitao: string;
    makho?: string | null;
    nguoinhan?: string | null;
    ghichu?: string | null;
    /** Số lượng cấp phát. Rỗng/0/không hợp lệ = cấp phát trọn số còn lại
     *  (ô nhập trên page truyền chuỗi nên nhận cả string). */
    soluong?: number | string | null;
    loaiphieu?: number | null;
  },
): Promise<Array<{ sopx: string; soluong: number; message: string }>> {
  if (!args.line_uuid) throw new Error("Chưa chọn dòng lệnh cấp phát");
  if (!args.nguoitao) throw new Error("Thiếu nguoitao");

  return db.transaction(async (tx) => {
    const lcp = await procTable(tx, companyId, "tr_lenhcapphat");
    const [line] = await lcp.listWhere(sql`id = ${args.line_uuid}::uuid`, { limit: 1 });
    if (!line) throw new Error("Không tìm thấy dòng lệnh cấp phát");

    const lenhcapphatid = (line.lenhcapphatid as string) ?? null;
    const mavt = (line.mavt as string) ?? null;
    const yeucau = Number(line.soluong) || 0;
    const daphat0 = Number(line.soluong_daphat) || 0;
    const conlai0 =
      line.soluong_conlai != null ? Number(line.soluong_conlai) : Math.max(yeucau - daphat0, 0);
    const lineIntId = line.id != null ? Number(line.id) : null;

    // Rỗng / "" / 0 / không phải số dương → cấp phát trọn số còn lại.
    const nhap = args.soluong == null || args.soluong === "" ? Number.NaN : Number(args.soluong);
    const qty = Number.isFinite(nhap) && nhap > 0 ? nhap : conlai0;
    if (!(qty > 0)) {
      return [
        { sopx: "", soluong: 0, message: "Dòng đã cấp phát đủ — không còn số lượng để xuất" },
      ];
    }
    if (!mavt) throw new Error("Dòng không có mã vật tư (mavt) để xuất kho");

    const now = new Date();
    const nowIso = now.toISOString();

    // 1) sinh sopx — TR_PHIEUXUAT_NEWID: PX + ddMMyy + STT(2 chữ số), bảo đảm unique.
    const px = await procTable(tx, companyId, "tr_phieuxuat");
    const todayRows = await px.listWhere(sql`(${px.ts("ngaytao")})::date = ${nowIso}::date`);
    let counter = todayRows.length;
    let sopx = "";
    for (let i = 0; i < 1000; i++) {
      sopx = `PX${ddMMyy(now)}${pad2(counter + 1)}`;
      const [dup] = await px.listWhere(sql`${px.text("sopx")} = ${sopx}`, { limit: 1 });
      if (!dup) break;
      counter++;
    }

    // 2) header phiếu xuất — TR_PHIEUXUAT_INSERT2 (IsXuat=1).
    await px.insertRow({
      sopx,
      lenhcapphat: lenhcapphatid,
      makho: args.makho ?? null,
      nguoinhan: args.nguoinhan ?? null,
      ghichu: args.ghichu ?? null,
      nguoitao: args.nguoitao,
      ngaytao: nowIso,
      active: true,
      loaiphieu: args.loaiphieu ?? null,
      donhang: (line.madondathang as string) ?? null,
      isxuat: true,
      ngayxuat: nowIso,
    });

    // 3) chi tiết phiếu — TR_CTPHIEUXUAT_INSERT2 (phieuxuat = sopx, link dòng LCP qua id int).
    const ct = await procTable(tx, companyId, "tr_ctphieuxuat");
    await ct.insertRow({
      lenhcapphat: lenhcapphatid,
      phieuxuat: sopx,
      makho: args.makho ?? null,
      mact: mavt,
      soluong: qty,
      nguoitao: args.nguoitao,
      ngaytao: nowIso,
      id_chitiet_lcp: lineIntId,
    });

    // 4) cập nhật dòng LCP — TR_LENHCAPPHAT_Update: daphat += qty; conlai = yeucau - daphat (>=0);
    //    capphat = (conlai <= 0).
    const daphat = daphat0 + qty;
    const conlai = Math.max(yeucau - daphat, 0);
    await lcp.updateWhere(
      { soluong_daphat: daphat, soluong_conlai: conlai, capphat: conlai <= 0 },
      sql`id = ${args.line_uuid}::uuid`,
    );

    // 5) trừ tồn FIFO — TR_TONKHO_CHITIET_XUAT: rút dần từ các kệ có tồn của mavt,
    //    ORDER BY keso, soluong cho tới khi đủ qty.
    const stock = await procTable(tx, companyId, "tr_tonkho_chitiet");
    const tonRows = await stock.listWhere(
      sql`${stock.text("mavt")} = ${mavt} AND ${stock.num("soluong")} > 0`,
      { orderBy: sql`${stock.text("keso")} ASC, ${stock.num("soluong")} ASC` },
    );
    let remain = qty;
    for (const r of tonRows) {
      if (remain <= 0) break;
      const ton = Number(r.soluong) || 0;
      const rid = r._id as string;
      if (ton <= remain) {
        await stock.updateWhere({ soluong: 0 }, sql`id = ${rid}::uuid`);
        remain = Math.abs(remain - ton);
      } else {
        await stock.updateWhere({ soluong: ton - remain }, sql`id = ${rid}::uuid`);
        remain = 0;
      }
    }

    const thieu = remain > 0 ? ` (thiếu tồn ${remain} chưa trừ đủ)` : "";
    return [{ sopx, soluong: qty, message: `Đã cấp phát ${qty} — phiếu ${sopx}${thieu}` }];
  });
}
