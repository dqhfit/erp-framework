/* Nút "Lưu" trang Tính mét vuông sơn (9f2b1aa2): với SP đang chọn, tính TỔNG
   m² sơn rồi thực hiện:
     1) tr_sanpham.m2_son = tổng  (RAW SQL — bảng đang mirror, ghi local);
     2) tr_dinhmuc_son.m2  = tổng  (cho MỌI dòng định mức của SP);
     3) lưu chi tiết tính vào tr_dientich_matson (xoá bản cũ của SP → ghi mới)
        để có thể xem lại.

   Nguồn tổng theo kết cấu SP:
     - "Tháo rời"  → định mức gỗ ván (tr_dinhmuc_govan): tổng m2_son.
     - còn lại     → cụm sơn (tr_cumson_sanpham): tổng dientich_son (đã nhân %).

   Logic nghiệp vụ MỚI (không có proc DQHF gốc). tr_sanpham đang mirror nên
   procTable chặn ghi → cập nhật m2_son bằng RAW SQL (chỉ chạy local; trên prod
   cần cutover sync.state='live' cho tr_sanpham, nếu không MSSQL sẽ ghi đè). */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable, rows } from "../src/proc-table";

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

type Line = {
  stt: number | null;
  ma_cum: string | null;
  ten_cum: string | null;
  quycach: string | null;
  phantram: number | null;
  dientich: number | null;
};

export async function trDientichMatsonLuu(
  db: DB,
  companyId: string,
  args: { masp?: string | null },
): Promise<
  Array<{
    masp: string;
    loai: string;
    lines: number;
    tong_m2: number;
    dinhmuc_son: number;
    message: string;
  }>
> {
  const masp = args.masp ? String(args.masp) : "";
  if (!masp) throw new Error("Chưa chọn sản phẩm.");

  // 1) Kết cấu SP.
  const sp = await procTable(db, companyId, "tr_sanpham");
  const found = await sp.listWhere(sql`${sp.text("masp")} = ${masp}`, { limit: 1 });
  if (found.length === 0) throw new Error(`Không tìm thấy sản phẩm "${masp}".`);
  const ketcau = ((found[0]?.ketcau as string | undefined) ?? "").trim();

  // 2) Gom dòng chi tiết + tổng theo kết cấu.
  const lines: Line[] = [];
  let loai: string;
  if (ketcau === "Tháo rời") {
    loai = "Gỗ ván";
    const gv = await procTable(db, companyId, "tr_dinhmuc_govan");
    const rs = await gv.listWhere(sql`${gv.text("masp")} = ${masp}`, {
      orderBy: sql`${gv.num("stt")} ASC NULLS LAST`,
    });
    for (const r of rs) {
      lines.push({
        stt: r.stt == null ? null : Number(r.stt),
        ma_cum: (r.mact as string | undefined) ?? null,
        ten_cum: (r.chitiet as string | undefined) ?? null,
        quycach: r.dai_tc != null && r.rong_tc != null ? `${r.dai_tc} x ${r.rong_tc}` : null,
        phantram: 100,
        dientich: r.m2_son == null ? null : Number(r.m2_son),
      });
    }
  } else {
    loai = "Cụm sơn";
    const cs = await procTable(db, companyId, "tr_cumson_sanpham");
    const rs = await cs.listWhere(sql`${cs.text("masp")} = ${masp}`, {
      orderBy: sql`${cs.num("stt")} ASC NULLS LAST`,
    });
    for (const r of rs) {
      lines.push({
        stt: r.stt == null ? null : Number(r.stt),
        ma_cum: (r.ma_cum as string | undefined) ?? null,
        ten_cum: (r.ten_cum as string | undefined) ?? null,
        quycach: (r.quycach as string | undefined) ?? null,
        phantram: r.phantram_son == null ? null : Number(r.phantram_son),
        dientich: r.dientich_son == null ? null : Number(r.dientich_son),
      });
    }
  }
  if (lines.length === 0) {
    throw new Error(
      `Sản phẩm "${masp}" (${ketcau || "?"}) chưa có dữ liệu ${loai.toLowerCase()} để tính.`,
    );
  }
  const tong = round5(lines.reduce((s, l) => s + (l.dientich ?? 0), 0));

  // 3) tr_dinhmuc_son: m2 = tổng; sl_sp = sl_m2 × m2 (tiêu hao/SP) — mọi dòng
  //    của SP. sl_sp phụ thuộc sl_m2 TỪNG DÒNG nên dùng raw SQL (updateWhere chỉ
  //    set hằng). Bảng sync.state=null (không mirror) → ghi trực tiếp hợp lệ.
  const dmRes = await db.execute(sql`
    UPDATE tr_dinhmuc_son
    SET f_m2 = ${tong},
        f_sl_sp = round(coalesce(f_sl_m2, 0) * ${tong}, 5),
        version = version + 1,
        updated_at = now()
    WHERE company_id = ${companyId}::uuid AND f_masp = ${masp} AND deleted_at IS NULL
    RETURNING id
  `);
  const dmCount = rows(dmRes).length;

  // 4) tr_sanpham.m2_son = tổng (RAW SQL — bảng mirror).
  await db.execute(sql`
    UPDATE tr_sanpham SET f_m2_son = ${tong}, version = version + 1, updated_at = now()
    WHERE company_id = ${companyId}::uuid AND f_masp = ${masp} AND deleted_at IS NULL
  `);

  // 5) Lưu chi tiết vào tr_dientich_matson (thay bản cũ của SP).
  const dt = await procTable(db, companyId, "tr_dientich_matson");
  await dt.hardDeleteWhere(sql`${dt.text("masp")} = ${masp}`);
  const now = new Date().toISOString();
  for (const l of lines) {
    await dt.insertRow({
      masp,
      loai,
      stt: l.stt,
      ma_cum: l.ma_cum,
      ten_cum: l.ten_cum,
      quycach: l.quycach,
      phantram_son: l.phantram,
      dientich: l.dientich,
      tong_m2: tong,
      ngaytinh: now,
    });
  }

  const message =
    `Đã lưu: tổng ${tong} m² sơn (${loai}, ${lines.length} dòng) cho "${masp}". ` +
    `Cập nhật tr_sanpham.m2_son + ${dmCount} dòng tr_dinhmuc_son (m2 + sl_sp).`;
  return [{ masp, loai, lines: lines.length, tong_m2: tong, dinhmuc_son: dmCount, message }];
}
