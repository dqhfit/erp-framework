/* Port TR_KEHOACH_GIAOHANG_INSERT2 — dựng/refresh kế hoạch giao hàng cho
   đơn đặt hàng loại HTR (hàng trang).

   Luồng proc gốc:
   1. Lấy loaiddh của tr_dondathang theo maddh. Nếu loaiddh='OTHER' mà đơn
      có dòng chi tiết mã W (chitiet LIKE 'W%') → coi như 'HTR'.
   2. Chỉ xử lý khi loaiddh='HTR'. Dựng tập tạm từ tr_dondathang JOIN
      tr_dondathang_chitiet (chitiet LIKE 'W%') JOIN tr_sanpham, lọc header
      active=1, trangthai IN (0,1,2), pheduyet=1. cbm dòng = sanpham.cbm * soluong.
   3. Gộp chuỗi distinct (hehang/khachhang/donhang, sort + nối ', '),
      tổng cbm, số cont = cbm/68; rồi UPSERT tr_kehoach_giaohang theo maddh.

   Khác nguồn có chủ ý:
   - Proc gốc khi tập tạm RỖNG mà kế hoạch đã tồn tại sẽ UPDATE toàn NULL
     (biến T-SQL giữ NULL) — coi là bug nguồn, port KHÔNG tái hiện: tập
     rỗng → return không đổi gì.
   - JOIN tách thành các query đơn bảng + ghép trong JS (procTable không
     compose join đa bảng vì scope company_id không alias được).

   ufn_MaHTR_To_MaSP ĐÃ port inline (nguồn: proc-bodies/ufn_mahtr_to_masp.sql,
   bảng tr_chitiet_hangtrang đã import): masp rỗng → tra chi tiết hàng
   trắng theo mact, chọn masp đầu tiên có định mức gỗ ván; không có →
   dòng bị loại như INNER JOIN miss của nguồn.
   Nguồn: migration-plan/ui/proc-bodies/tr_kehoach_giaohang_insert2.sql */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { procTable } from "../src/proc-table";

/** Gộp chuỗi distinct không rỗng, sort tăng, nối ", " — same pattern
 *  COALESCE(@x + ', ', '') + val GROUP BY val ORDER BY val của nguồn. */
function aggDistinct(values: Array<unknown>): string | null {
  const set = [...new Set(values.map((v) => (v == null ? "" : String(v))).filter(Boolean))].sort();
  return set.length > 0 ? set.join(", ") : null;
}

export async function trKehoachGiaohangInsert2(
  db: DB,
  companyId: string,
  args: { maddh: string },
): Promise<void> {
  if (!args.maddh) throw new Error("Thiếu maddh");

  // 1. Header đơn đặt hàng.
  const tDdh = await procTable(db, companyId, "tr_dondathang");
  const [ddh] = await tDdh.listWhere(sql`${tDdh.text("maddh")} = ${args.maddh}`, { limit: 1 });
  if (!ddh) return; // proc gốc: @LOAIDDH NULL → không nhánh nào chạy

  // 2. Dòng chi tiết mã W của đơn.
  const tCt = await procTable(db, companyId, "tr_dondathang_chitiet");
  const details = await tCt.listWhere(
    sql`${tCt.text("maddh")} = ${args.maddh} AND ${tCt.text("chitiet")} LIKE ${"W%"}`,
  );

  let loaiddh = ddh.loaiddh == null ? null : String(ddh.loaiddh);
  if (loaiddh === "OTHER" && details.length > 0) loaiddh = "HTR";
  if (loaiddh !== "HTR") return;

  // 3. Lọc header như WHERE của #DONHANG: active=1, trangthai IN (0,1,2),
  //    pheduyet=1 (trangthai/pheduyet là text trên PG → so theo số).
  const trangthai = Number(ddh.trangthai);
  const pheduyet = Number(ddh.pheduyet);
  const headerOk = ddh.active === true && [0, 1, 2].includes(trangthai) && pheduyet === 1;
  if (!headerOk || details.length === 0) return; // tập tạm rỗng → không đổi gì (xem chú thích đầu file)

  // 4. Resolve sản phẩm cho từng dòng — masp rỗng thì suy qua
  //    ufn_MaHTR_To_MaSP (ĐÃ port, xem proc-bodies/ufn_mahtr_to_masp.sql):
  //    tra tr_chitiet_hangtrang (mact = chitiet) lấy các masp, chọn masp
  //    ĐẦU TIÊN có định mức gỗ ván (tr_dinhmuc_govan). Không có → null →
  //    dòng bị loại như INNER JOIN miss của nguồn.
  const needLookup = [
    ...new Set(
      details
        .filter((d) => String(d.masp ?? "").length === 0)
        .map((d) => String(d.chitiet ?? ""))
        .filter(Boolean),
    ),
  ];
  const htrToMasp = new Map<string, string>();
  if (needLookup.length > 0) {
    const tHtr = await procTable(db, companyId, "tr_chitiet_hangtrang");
    const htrRows = await tHtr.listWhere(
      sql`${tHtr.text("mact")} IN (${sql.join(
        needLookup.map((v) => sql`${v}`),
        sql`, `,
      )})`,
    );
    const candidates = [...new Set(htrRows.map((r) => String(r.masp ?? "")).filter(Boolean))];
    const coDinhmuc = new Set<string>();
    if (candidates.length > 0) {
      const tDm = await procTable(db, companyId, "tr_dinhmuc_govan");
      const dmRows = await tDm.listWhere(
        sql`${tDm.text("masp")} IN (${sql.join(
          candidates.map((v) => sql`${v}`),
          sql`, `,
        )})`,
      );
      for (const r of dmRows) {
        if (r.masp != null) coDinhmuc.add(String(r.masp));
      }
    }
    // Map mact → masp đầu tiên (theo thứ tự trả về) có định mức gỗ ván.
    for (const r of htrRows) {
      const mact = String(r.mact ?? "");
      const masp = String(r.masp ?? "");
      if (!mact || !masp || htrToMasp.has(mact)) continue;
      if (coDinhmuc.has(masp)) htrToMasp.set(mact, masp);
    }
  }
  const resolveMasp = (d: Record<string, unknown>): string => {
    const masp = d.masp == null ? "" : String(d.masp);
    if (masp.length > 0) return masp;
    return htrToMasp.get(String(d.chitiet ?? "")) ?? "";
  };
  const maspList = [...new Set(details.map(resolveMasp).filter(Boolean))];
  if (maspList.length === 0) return;

  const tSp = await procTable(db, companyId, "tr_sanpham");
  const sanphams = await tSp.listWhere(
    sql`${tSp.text("masp")} IN (${sql.join(
      maspList.map((m) => sql`${m}`),
      sql`, `,
    )})`,
  );
  const spByMasp = new Map(sanphams.map((sp) => [String(sp.masp ?? ""), sp]));

  // 5. Ghép tập tạm #DONHANG trong JS — INNER JOIN: dòng không có sản phẩm bị loại.
  const rowsJoined = details.flatMap((d) => {
    const sp = spByMasp.get(resolveMasp(d));
    if (!sp) return [];
    const soluong = Number(d.soluong ?? 0);
    const spCbm = Number(sp.cbm ?? 0);
    return [
      {
        hehang: sp.hehang,
        customer: sp.customer,
        donhang: d.donhang,
        cbm: (Number.isFinite(spCbm) ? spCbm : 0) * (Number.isFinite(soluong) ? soluong : 0),
      },
    ];
  });
  if (rowsJoined.length === 0) return;

  const hehang = aggDistinct(rowsJoined.map((r) => r.hehang));
  const khachhang = aggDistinct(rowsJoined.map((r) => r.customer));
  const donhang = aggDistinct(rowsJoined.map((r) => r.donhang));
  const cbmSum = rowsJoined.reduce((s, r) => s + r.cbm, 0);
  const cont = cbmSum / 68;

  // 6. UPSERT tr_kehoach_giaohang theo maddh.
  const tKh = await procTable(db, companyId, "tr_kehoach_giaohang");
  const whereKh = sql`${tKh.text("maddh")} = ${args.maddh}`;
  const existing = await tKh.listWhere(whereKh, { limit: 1 });
  if (existing.length > 0) {
    await tKh.updateWhere(
      {
        ngaygiaohang: ddh.ngaygiao ?? null,
        mancc: ddh.mancc ?? null,
        tenncc: ddh.tenncc ?? null,
        cbm: cbmSum,
        soluong_cont: cont,
        donhang,
        hehang,
        khachhang,
      },
      whereKh,
    );
  } else {
    await tKh.insertRow({
      maddh: args.maddh,
      ngaygiaohang: ddh.ngaygiao ?? null,
      mancc: ddh.mancc ?? null,
      tenncc: ddh.tenncc ?? null,
      cbm: cbmSum,
      soluong_cont: cont,
      batdau: null,
      ketthuc: null,
      loaiddh: "HTR",
      donhang,
      hehang,
      khachhang,
    });
  }
}
