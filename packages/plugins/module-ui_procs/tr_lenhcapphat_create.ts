/* Port TR_LENHCAPPHAT_CREATE — sinh / cập nhật LỆNH CẤP PHÁT theo sản phẩm
   trong 1 đơn, từ ĐỊNH MỨC (BOM). Nguồn: proc MSSQL TR_LENHCAPPHAT_CREATE
   (migration-plan/ui/proc-bodies/tr_lenhcapphat_create.sql).

   1 lần gọi = lặp các combo (loaidonhang × loaicapphat). Mỗi combo:
     - head theo (loaidonhang, madondathang=đơn, loaicapphat): chưa có → tạo
       (id LCP<ddMMyy><seq>); có → cập nhật ngaysua.
     - đọc định mức theo cờ → mỗi mã chi tiết: soluong = định_mức × SL_đơn.
     - vô hiệu dòng cũ (active=0) rồi insert/update từng dòng, GIỮ soluong_daphat
       (idempotent — chạy lại = đồng bộ theo định mức mới).

   MAPPING (theo proc gốc):
     NKI/BEFORE → tr_dinhmuc_ngukim HWforWW=1 ; NKI/AFTER → HWforPacking=1 ;
     NKI/AI → HWforAI=1 ; SON/SONTRONG → tr_dinhmuc_son sontrongsanpham=1 ;
     SON/SONNGOAI → sontrongsanpham=0 ; SON/UV → tr_sanpham×tr_quytrinh_lanuv ;
     DGO → tr_dinhmuc_donggoi.

   PHẠM VI bản này: chỉ ĐƠN SẢN XUẤT (order_number ∈ tr_order). Hàng trắng
   (đơn đặt hàng trắng, master_code/maHTR) port sau. */
import type { DB } from "@erp-framework/server/db";
import { sql } from "drizzle-orm";
import { type ProcDb, procTable } from "../src/proc-table";

type Combo = { dinhmuc: "NKI" | "SON" | "DGO"; loai: string };
const COMBOS: Combo[] = [
  { dinhmuc: "NKI", loai: "BEFORE" },
  { dinhmuc: "NKI", loai: "AFTER" },
  { dinhmuc: "NKI", loai: "AI" },
  { dinhmuc: "SON", loai: "SONTRONG" },
  { dinhmuc: "SON", loai: "SONNGOAI" },
  { dinhmuc: "SON", loai: "UV" },
  { dinhmuc: "DGO", loai: "" },
];

const pad2 = (n: number) => String(n).padStart(2, "0");
const ddMMyy = (d: Date) =>
  pad2(d.getDate()) + pad2(d.getMonth() + 1) + String(d.getFullYear()).slice(-2);

/** Gộp các dòng định mức theo mã chi tiết, cộng dồn số lượng. */
function groupSum(rows: Array<Record<string, unknown>>, keyField: string, slField: string) {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = String(r[keyField] ?? "").trim();
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + (Number(r[slField]) || 0));
  }
  return [...m.entries()].map(([mact, sl]) => ({ mact, sl }));
}

/** Đọc định mức cho 1 combo → [{mact, sl}] (số lượng cho 1 đơn vị sản phẩm). */
async function getDinhMuc(
  db: ProcDb,
  companyId: string,
  c: Combo,
  masp: string,
): Promise<Array<{ mact: string; sl: number }>> {
  if (c.dinhmuc === "NKI") {
    const flag = c.loai === "BEFORE" ? "hwforww" : c.loai === "AFTER" ? "hwforpacking" : "hwforai";
    const dm = await procTable(db, companyId, "tr_dinhmuc_ngukim");
    const rs = await dm.listWhere(sql`${dm.text("masp")} = ${masp} AND ${dm.bool(flag)} = true`);
    return groupSum(rs, "mavt", "soluong");
  }
  if (c.dinhmuc === "DGO") {
    const dm = await procTable(db, companyId, "tr_dinhmuc_donggoi");
    const rs = await dm.listWhere(sql`${dm.text("masp")} = ${masp}`);
    return groupSum(rs, "madonggoi", "soluong");
  }
  // SON trong / ngoài
  if (c.loai === "SONTRONG" || c.loai === "SONNGOAI") {
    const dm = await procTable(db, companyId, "tr_dinhmuc_son");
    const want = c.loai === "SONTRONG";
    const rs = await dm.listWhere(
      sql`${dm.text("masp")} = ${masp} AND ${dm.bool("sontrongsanpham")} = ${want}`,
    );
    return groupSum(rs, "mact", "sl_sp");
  }
  // SON UV: m2_son (sản phẩm) × dinhluong (quy trình lăn UV theo bảng màu) / 1000
  const sp = await procTable(db, companyId, "tr_sanpham");
  const spRows = await sp.listWhere(sql`${sp.text("masp")} = ${masp}`, { limit: 1 });
  const mauuv = String(spRows[0]?.mauuv ?? "").trim();
  const m2son = Number(spRows[0]?.m2_son) || 0;
  if (!mauuv || m2son <= 0) return [];
  const qt = await procTable(db, companyId, "tr_quytrinh_lanuv");
  const qtRows = await qt.listWhere(
    sql`${qt.text("bangmau")} = ${mauuv} AND coalesce(${qt.text("mact")}, '') <> ''`,
  );
  const m = new Map<string, number>();
  for (const r of qtRows) {
    const mact = String(r.mact ?? "").trim();
    if (!mact) continue;
    m.set(mact, (m.get(mact) ?? 0) + (m2son * (Number(r.dinhluong) || 0)) / 1000);
  }
  return [...m.entries()].map(([mact, sl]) => ({ mact, sl }));
}

export interface LcpCreateResult {
  masp?: string;
  loaidonhang: string;
  loaicapphat: string;
  lenhcapphatid?: string;
  created: number;
  updated: number;
  skipped: boolean;
  message: string;
}

export async function trLenhcapphatCreate(
  db: DB,
  companyId: string,
  args: {
    /** 1 hoặc nhiều mã sản phẩm (selMasp tagbox = mảng). */
    masp: string | string[];
    madonhang: string;
    mode?: "sync" | "create";
    nguoitao?: string | null;
  },
): Promise<LcpCreateResult[]> {
  const masps = (Array.isArray(args.masp) ? args.masp : [args.masp])
    .map((s) => String(s ?? "").trim())
    .filter(Boolean);
  const madonhang = String(args.madonhang ?? "").trim();
  if (masps.length === 0 || !madonhang) throw new Error("Chưa chọn sản phẩm hoặc đơn hàng");
  const mode = args.mode === "create" ? "create" : "sync";
  const nguoi = args.nguoitao ?? null;
  const now = new Date();
  const nowIso = now.toISOString();
  const datePart = ddMMyy(now);

  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as ProcDb;
    const order = await procTable(tx, companyId, "tr_order");
    const isSX =
      (await order.listWhere(sql`${order.text("order_number")} = ${madonhang}`, { limit: 1 }))
        .length > 0;
    if (!isSX) {
      return [
        {
          loaidonhang: "",
          loaicapphat: "",
          created: 0,
          updated: 0,
          skipped: true,
          message: `Đơn "${madonhang}" không phải đơn sản xuất — Hàng trắng (HTR) chưa hỗ trợ ở bản này`,
        },
      ];
    }

    const od = await procTable(tx, companyId, "tr_order_detail");
    const head = await procTable(tx, companyId, "tr_lenhcapphat_head");
    const detail = await procTable(tx, companyId, "tr_lenhcapphat");

    // Các id head đã có trong ngày → sinh seq không trùng.
    const todayIds = new Set(
      (await head.listWhere(sql`${head.text("lenhcapphatid")} LIKE ${`LCP${datePart}%`}`)).map(
        (r) => String(r.lenhcapphatid ?? ""),
      ),
    );
    let seq = todayIds.size;
    const nextHeadId = () => {
      let id = "";
      do {
        seq += 1;
        id = `LCP${datePart}${pad2(seq)}`;
      } while (todayIds.has(id));
      todayIds.add(id);
      return id;
    };

    const loaicapCond = (loai: string) =>
      loai
        ? sql`${detail.text("loaicapphat")} = ${loai}`
        : sql`(${detail.raw("loaicapphat")} IS NULL OR ${detail.text("loaicapphat")} = '')`;
    const loaicapCondHead = (loai: string) =>
      loai
        ? sql`${head.text("loaicapphat")} = ${loai}`
        : sql`(${head.raw("loaicapphat")} IS NULL OR ${head.text("loaicapphat")} = '')`;

    // Head dùng chung theo combo: nhiều SP cùng đơn + loại → chung 1 head
    // (các dòng SP khác mavt nằm dưới cùng head). Cache trong 1 lần gọi.
    const headCache = new Map<string, string>();
    const ensureHead = async (c: Combo): Promise<string> => {
      const key = `${c.dinhmuc}|${c.loai}`;
      const cached = headCache.get(key);
      if (cached) return cached;
      const headRows = await head.listWhere(
        sql`${head.text("loaidonhang")} = ${c.dinhmuc} AND ${head.text("madondathang")} = ${madonhang} AND ${loaicapCondHead(c.loai)}`,
        { limit: 1 },
      );
      let headId = headRows[0] ? String(headRows[0].lenhcapphatid ?? "") : "";
      if (!headId) {
        headId = nextHeadId();
        await head.insertRow({
          lenhcapphatid: headId,
          loaidonhang: c.dinhmuc,
          loaicapphat: c.loai || undefined,
          madondathang: madonhang,
          hoanthanh: false,
          vuotdinhmuc: false,
          active: true,
          nguoitao: nguoi,
          ngaytao: nowIso,
          nguoisua: nguoi,
          ngaysua: nowIso,
        });
      } else {
        await head.updateWhere(
          { ngaysua: nowIso, nguoisua: nguoi },
          sql`${head.text("lenhcapphatid")} = ${headId}`,
        );
      }
      headCache.set(key, headId);
      return headId;
    };

    const results: LcpCreateResult[] = [];

    for (const masp of masps) {
      const maHTR = masp; // SX: detail.masp = master_code = masp
      // SL sản phẩm trong đơn (item_number = masp; bỏ dòng huỷ).
      const odRows = await od.listWhere(
        sql`${od.text("order_number")} = ${madonhang} AND ${od.text("item_number")} = ${masp} AND coalesce(${od.text("f_cancelled")}, 'N') <> 'Y'`,
      );
      const slDonHang = odRows.reduce((s, r) => s + (Number(r.order_qty) || 0), 0);

      for (const c of COMBOS) {
        const dm = await getDinhMuc(tx, companyId, c, masp);
        if (dm.length === 0) continue; // SP không có định mức combo này → bỏ qua
        if (slDonHang <= 0) {
          results.push({
            masp,
            loaidonhang: c.dinhmuc,
            loaicapphat: c.loai,
            created: 0,
            updated: 0,
            skipped: true,
            message: `${masp}: thiếu số lượng đơn (=0)`,
          });
          continue;
        }

        if (mode === "create") {
          const existing = await detail.listWhere(
            sql`${detail.text("loaidonhang")} = ${c.dinhmuc} AND ${loaicapCond(c.loai)} AND ${detail.text("madonhang")} = ${madonhang} AND ${detail.text("masp")} = ${masp} AND ${detail.bool("active")} = true`,
            { limit: 1 },
          );
          if (existing.length > 0) {
            results.push({
              masp,
              loaidonhang: c.dinhmuc,
              loaicapphat: c.loai,
              created: 0,
              updated: 0,
              skipped: true,
              message: `${masp}: đã có LCP — dùng 'Cập nhật LCP'`,
            });
            continue;
          }
        }

        const headId = await ensureHead(c);

        // Vô hiệu dòng cũ (head, masp) — dòng không còn trong định mức ở active=0.
        await detail.updateWhere(
          { active: false },
          sql`${detail.text("lenhcapphatid")} = ${headId} AND ${detail.text("masp")} = ${masp}`,
        );

        let created = 0;
        let updated = 0;
        for (const line of dm) {
          const slCan = line.sl * slDonHang;
          const old = await detail.listWhere(
            sql`${detail.text("lenhcapphatid")} = ${headId} AND ${detail.text("madonhang")} = ${madonhang} AND ${detail.text("masp")} = ${masp} AND ${detail.text("mavt")} = ${line.mact}`,
            { limit: 1 },
          );
          const daPhat = old[0] ? Number(old[0].soluong_daphat) || 0 : 0;
          const conLai = slCan - daPhat;
          if (old[0]) {
            await detail.updateWhere(
              {
                soluong_donhang: slDonHang,
                soluong: slCan,
                soluong_daphat: daPhat,
                soluong_conlai: conLai,
                active: true,
                nguoisua: nguoi,
                ngaysua: nowIso,
              },
              sql`id = ${old[0]._id}::uuid`,
            );
            updated += 1;
          } else {
            await detail.insertRow({
              lenhcapphatid: headId,
              loaidonhang: c.dinhmuc,
              loaicapphat: c.loai || undefined,
              madondathang: null,
              madonhang,
              master_code: masp,
              masp: maHTR,
              mavt: line.mact,
              soluong_donhang: slDonHang,
              soluong: slCan,
              soluong_daphat: daPhat,
              soluong_conlai: conLai,
              nguoitao: nguoi,
              ngaytao: nowIso,
              nguoisua: nguoi,
              ngaysua: nowIso,
              active: true,
            });
            created += 1;
          }
        }
        results.push({
          masp,
          loaidonhang: c.dinhmuc,
          loaicapphat: c.loai,
          lenhcapphatid: headId,
          created,
          updated,
          skipped: false,
          message: `${masp} ${c.dinhmuc}/${c.loai || "-"}: ${created} mới, ${updated} cập nhật`,
        });
      }
    }

    if (results.length === 0) {
      results.push({
        loaidonhang: "",
        loaicapphat: "",
        created: 0,
        updated: 0,
        skipped: true,
        message: "Sản phẩm chưa có định mức (ngũ kim / sơn / đóng gói)",
      });
    }
    return results;
  });
}
