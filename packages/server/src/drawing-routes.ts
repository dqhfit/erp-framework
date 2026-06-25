/* ==========================================================
   drawing-routes.ts — Tra + xem bản vẽ (màn XAF SanPham_DetailView_XemBanVe,
   DQHF252) cho trang mobile xưởng. Master = sản phẩm (masp), 4 tab:
     - Bản vẽ        : tr_banve PDF (phanloai = loại chọn, ≠ 'Bản vẽ dao')
     - Bản vẽ dao    : tr_banve PDF (phanloai LIKE 'Bản vẽ dao%')
     - Định mức gỗ ván: grid tr_dinhmuc_govan theo masp
     - Định mức ngũ kim: grid tr_dinhmuc_ngukim theo masp

   Endpoint (auth session cookie → company → view:entity):
     GET /banvesvc/product?masp=  → JSON {tensp, banve[], govan[], ngukim[]}
     GET /banvesvc/resolve?code=  → JSON {masp}  (QR thẻ pallet / "Đơn:SP:CT" +
                                  fallback masp_thaythe)
     GET /banvesvc/file?id=       → stream PDF (local) hoặc 302 viewer PDF.js.

   Đọc data qua getRecordStore (HYBRID tier-safe: typed col f_ / ext jsonb).
   ========================================================== */

import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { resolve as resolvePath, sep } from "node:path";
import { Readable } from "node:stream";
import { type Role, roleCan } from "@erp-framework/core";
import { sessions } from "@erp-framework/db";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { SESSION_COOKIE } from "./auth";
import { resolveActiveCompany } from "./context";
import type { DB } from "./db";
import { getRecordStore } from "./record-store";

async function authView(
  db: DB,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ companyId: string; userId: string } | null> {
  const sid = (req.cookies as Record<string, string | undefined>)?.[SESSION_COOKIE];
  if (!sid) {
    reply.code(401).send({ error: "Chưa đăng nhập" });
    return null;
  }
  const [s] = await db.select().from(sessions).where(eq(sessions.id, sid));
  if (!s || s.expiresAt < new Date()) {
    reply.code(401).send({ error: "Phiên hết hạn" });
    return null;
  }
  const active = await resolveActiveCompany(db, s.userId, s.activeCompanyId);
  if (!active) {
    reply.code(403).send({ error: "Bạn chưa thuộc công ty nào" });
    return null;
  }
  if (!roleCan(active.role as Role, "view", "entity")) {
    reply.code(403).send({ error: 'Vai trò không có quyền "view:entity"' });
    return null;
  }
  return { companyId: active.companyId, userId: s.userId };
}

/** MIME theo đuôi file — bản vẽ AI có thể là svg/html, không chỉ pdf. */
function mimeByExt(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "svg":
      return "image/svg+xml";
    case "html":
    case "htm":
      return "text/html; charset=utf-8";
    case "png":
      return "image/png";
    default:
      return "application/pdf";
  }
}

/** URL viewer PDF.js — port y hệt FnSanPham.GetLinkViewPDFFile. */
function pdfViewerUrl(filepath: string, host?: string): string {
  const base = process.env.BANVE_PDFJS_BASE ?? "https://view.dongquochung.com:4432";
  let targetFile = filepath;
  if (filepath.startsWith("/f/")) {
    if (host) {
      const protocol = host.includes("localhost") || host.includes("127.0.0.1") ? "http" : "https";
      targetFile = `${protocol}://${host}${filepath}`;
    }
  } else {
    targetFile = `/f/${filepath.replace(/\\/g, "/")}`;
  }
  const value = encodeURIComponent(targetFile).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${base.replace(/\/+$/, "")}/web/viewer.html?file=${value}`;
}

/** URL file PDF THÔ trên file-server (endpoint /f/ mà viewer nạp qua `file=`).
    Dùng để server PROXY bytes về cho pdfjs phía client (client không gọi chéo
    origin file-server + endpoint /banvesvc cần cookie auth của ta). Cùng cách
    encode path như pdfViewerUrl. */
function pdfRawUrl(filepath: string): string {
  const base = process.env.BANVE_PDFJS_BASE ?? "https://view.dongquochung.com:4432";
  const value = encodeURIComponent(filepath.replace(/\\/g, "/")).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${base.replace(/\/+$/, "")}/f/${value}`;
}

/** entityId theo tên (company-scoped). null nếu không có. */
async function entityIdByName(db: DB, companyId: string, name: string): Promise<string | null> {
  const r = (await db.execute(
    sql`SELECT id FROM entities WHERE company_id = ${companyId}::uuid AND lower(name) = lower(${name}) LIMIT 1`,
  )) as unknown as Array<{ id: string }>;
  return r[0]?.id ?? null;
}

/** List record của 1 entity theo masp (HYBRID tier-safe). Trả mảng data + id. */
async function listByMasp(
  db: DB,
  companyId: string,
  entityId: string,
  masp: string,
  limit = 500,
): Promise<Array<{ _id: string; data: Record<string, unknown> }>> {
  const out = await getRecordStore(db).list(companyId, entityId, {
    filters: { masp: { op: "=", value: masp } },
    limit,
    withTotal: false,
  });
  return out.rows.map((r) => ({ _id: r.id, data: (r.data ?? {}) as Record<string, unknown> }));
}

const isActive = (v: unknown) => v == null || !["0", "false"].includes(String(v));

export function registerDrawingRoutes(app: FastifyInstance, db: DB): void {
  // ── Công đoạn (c_location *-PROD) mà user đang đăng nhập được xếp ──
  //    Map: users.legacy_username = trtb_scan_op.f_user_id (username DQHF) →
  //    f_scan_location; join trtb_m_location lấy tên hiển thị (f_n_location).
  //    Port DoiCongDoanAction_CustomizePopupWindowParams (CongDoanDController,
  //    DQHF252): lọc location theo scan_op của user + kết thúc "-PROD".
  app.get("/banvesvc/my-stages", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const urows = (await db.execute(
      sql`SELECT legacy_username FROM users WHERE id = ${auth.userId}::uuid LIMIT 1`,
    )) as unknown as Array<{ legacy_username: string | null }>;
    const uname = (urows[0]?.legacy_username ?? "").trim();
    if (!uname) return reply.send({ username: null, stages: [] });
    const rows = (await db.execute(sql`
      SELECT DISTINCT s.f_scan_location AS cloc, l.f_n_location AS name, l.f_c_op AS op
      FROM trtb_scan_op s
      JOIN trtb_m_location l
        ON l.company_id = s.company_id
       AND l.f_c_location = s.f_scan_location
       AND l.deleted_at IS NULL
      WHERE s.company_id = ${auth.companyId}::uuid
        AND s.deleted_at IS NULL
        AND lower(s.f_user_id) = lower(${uname})
        AND s.f_scan_location LIKE '%-PROD'
      ORDER BY l.f_n_location
    `)) as unknown as Array<{ cloc: string; name: string | null; op: string | null }>;
    return reply.send({
      username: uname,
      stages: rows.map((r) => ({ cLocation: r.cloc, name: r.name ?? r.cloc, op: r.op ?? "" })),
    });
  });

  // ── Danh sách record cho các tab dưới màn Nhập sản lượng (theo công đoạn) ──
  //    type=hoanthanh (GIAO ở công đoạn này, tuần này) | nhanhang (record ở
  //    công đoạn *-IN tương ứng, chưa hoàn thành, 90 ngày) | hangloi
  //    (tr_baocao_hangloi ở công đoạn này, 90 ngày). Ra/Vào cổng: bảng
  //    ns_ravaocong CHƯA migrate → frontend hiện placeholder.
  app.get("/banvesvc/sl-records", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const q = (req.query ?? {}) as { type?: string; congDoan?: string };
    const congDoan = (q.congDoan ?? "").trim();
    const type = (q.type ?? "").trim();
    if (!congDoan) return reply.send({ rows: [] });
    const cid = auth.companyId;
    // Ngày VN (UTC+7): thứ 2 đầu tuần + 90 ngày trước.
    const vn = new Date(Date.now() + 7 * 3600 * 1000);
    const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const dow = (vn.getUTCDay() + 6) % 7; // 0 = thứ 2
    const monday = isoDay(vn.getTime() - dow * 86400000);
    const ago90 = isoDay(vn.getTime() - 90 * 86400000);

    let rows: Record<string, unknown>[] = [];
    if (type === "hoanthanh") {
      rows = (await db.execute(sql`
        SELECT f_madonhang AS madonhang, f_tenct AS tenct, f_oday AS oday, f_orong AS orong,
               f_odai AS odai, f_soluong AS soluong, f_sokhoi AS sokhoi,
               f_ngaythang AS ngaythang, f_nguoitao AS nguoitao
        FROM tr_trangthai_sanxuat
        WHERE company_id = ${cid}::uuid AND deleted_at IS NULL
          AND f_congdoan = ${congDoan} AND f_ngaythang >= ${monday}
        ORDER BY f_ngaythang DESC, f_ngaytao DESC LIMIT 200`)) as unknown as Record<
        string,
        unknown
      >[];
    } else if (type === "nhanhang") {
      const inLoc = congDoan.replace(/-PROD$/, "-IN");
      rows = (await db.execute(sql`
        SELECT f_madonhang AS madonhang, f_tenct AS tenct, f_oday AS oday, f_orong AS orong,
               f_odai AS odai, f_soluong AS soluong, f_ngaythang AS ngaythang,
               f_congdoantieptheo AS congdoantieptheo
        FROM tr_trangthai_sanxuat
        WHERE company_id = ${cid}::uuid AND deleted_at IS NULL
          AND f_congdoan = ${inLoc} AND f_ishoanthanh IS NOT TRUE
          AND f_ngaythang >= ${ago90}
        ORDER BY f_ngaythang DESC LIMIT 200`)) as unknown as Record<string, unknown>[];
    } else if (type === "hangloi") {
      rows = (await db.execute(sql`
        SELECT f_ngaythang AS ngaythang, f_donhang AS donhang, f_tenct AS tenct,
               f_dayy AS dayy, f_rong AS rong, f_dai AS dai, f_soluong AS soluong,
               f_loailoi AS loailoi, f_nguyennhan AS nguyennhan,
               f_huongxuly AS huongxuly, f_nguoiphutrach AS nguoiphutrach
        FROM tr_baocao_hangloi
        WHERE company_id = ${cid}::uuid AND deleted_at IS NULL
          AND f_congdoan = ${congDoan} AND f_ngaythang >= ${ago90}
        ORDER BY f_ngaythang DESC LIMIT 200`)) as unknown as Record<string, unknown>[];
    } else if (type === "ravao") {
      // ns_ravaocong có thể CHƯA migrate → entityIdByName null → pending (FE
      // hiện thông báo, không lỗi). getRecordStore tier-safe theo cột runtime.
      const rvId = await entityIdByName(db, cid, "ns_ravaocong");
      if (!rvId) return reply.send({ rows: [], pending: true });
      const out = await getRecordStore(db).list(cid, rvId, {
        filters: { congdoan: { op: "=", value: congDoan } },
        limit: 200,
        withTotal: false,
      });
      rows = out.rows
        .map((r) => (r.data ?? {}) as Record<string, unknown>)
        .sort((a, b) => String(b.ngay ?? "").localeCompare(String(a.ngay ?? "")));
    }
    return reply.send({ rows });
  });

  // ── Cascade tìm thẻ pallet cho Nhập sản lượng: đơn hàng → chi tiết → thẻ.
  //    (tr_pallet.f_dondathang, tr_pallet_card.f_mact_snap/f_card_no đều typed). ──
  app.get("/banvesvc/sl-orders", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const rows = (await db.execute(sql`
      SELECT f_dondathang AS dondathang
      FROM tr_pallet
      WHERE company_id = ${auth.companyId}::uuid AND deleted_at IS NULL
        AND f_dondathang IS NOT NULL AND f_dondathang <> ''
      GROUP BY f_dondathang ORDER BY max(f_ngaytao) DESC NULLS LAST LIMIT 1000`)) as unknown as Record<
      string,
      unknown
    >[];
    return reply.send({ rows });
  });
  app.get("/banvesvc/sl-pallet-chitiet", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const q = (req.query ?? {}) as { dondathang?: string; congDoan?: string; diqua?: string };
    const dondathang = (q.dondathang ?? "").trim();
    const congDoan = (q.congDoan ?? "").trim();
    const diqua = Number(q.diqua) > 0 ? Math.trunc(Number(q.diqua)) : 1;
    if (!dondathang) return reply.send({ rows: [] });
    const cid = auth.companyId;
    // socard = số thẻ CÒN CẦN (còn cần > 0) tại công đoạn hiện tại; chỉ giữ chi
    // tiết còn thẻ chưa làm xong (HAVING) — khớp với việc ẩn thẻ còn cần = 0.
    const dalamJoin = congDoan
      ? sql`LEFT JOIN (
          SELECT f_pcard, sum(f_soluong) AS dalam FROM tr_trangthai_sanxuat
          WHERE company_id = ${cid}::uuid AND deleted_at IS NULL
            AND f_congdoan = ${congDoan} AND f_diqua = ${diqua}
          GROUP BY f_pcard) d ON d.f_pcard = c.f_card_no`
      : sql``;
    const remain = congDoan
      ? sql`(coalesce(c.f_soluong, 0) - coalesce(d.dalam, 0))`
      : sql`coalesce(c.f_soluong, 0)`;
    const rows = (await db.execute(sql`
      SELECT c.f_mact_snap AS mact, max(c.f_tenct_snap) AS tenct, max(c.f_stt_snap) AS stt,
             count(*) FILTER (WHERE ${remain} > 0) AS socard
      FROM tr_pallet_card c JOIN tr_pallet p ON p.f_id = c.f_pallet_id
      ${dalamJoin}
      WHERE p.company_id = ${cid}::uuid AND p.deleted_at IS NULL
        AND c.deleted_at IS NULL AND p.f_dondathang = ${dondathang}
      GROUP BY c.f_mact_snap
      HAVING count(*) FILTER (WHERE ${remain} > 0) > 0
      ORDER BY max(c.f_stt_snap) LIMIT 2000`)) as unknown as Record<string, unknown>[];
    return reply.send({ rows });
  });
  app.get("/banvesvc/sl-pallet-cards", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const q = (req.query ?? {}) as {
      dondathang?: string;
      mact?: string;
      congDoan?: string;
      diqua?: string;
    };
    const dondathang = (q.dondathang ?? "").trim();
    const mact = (q.mact ?? "").trim();
    const congDoan = (q.congDoan ?? "").trim();
    const diqua = Number(q.diqua) > 0 ? Math.trunc(Number(q.diqua)) : 1;
    if (!dondathang || !mact) return reply.send({ rows: [] });
    const cid = auth.companyId;
    // "Còn cần" = soluong − số đã làm tại công đoạn hiện tại (cùng diqua) —
    // khớp logic cardinfo. Bỏ qua nếu không biết công đoạn.
    const dalamJoin = congDoan
      ? sql`LEFT JOIN (
          SELECT f_pcard, sum(f_soluong) AS dalam FROM tr_trangthai_sanxuat
          WHERE company_id = ${cid}::uuid AND deleted_at IS NULL
            AND f_congdoan = ${congDoan} AND f_diqua = ${diqua}
          GROUP BY f_pcard) d ON d.f_pcard = c.f_card_no`
      : sql``;
    const dalamCol = congDoan
      ? sql`coalesce(d.dalam, 0) AS dalam, (coalesce(c.f_soluong, 0) - coalesce(d.dalam, 0)) AS concan`
      : sql`0 AS dalam, c.f_soluong AS concan`;
    // Ẩn thẻ đã làm xong tại công đoạn này (còn cần = 0).
    const concanCond = congDoan
      ? sql`AND (coalesce(c.f_soluong, 0) - coalesce(d.dalam, 0)) > 0`
      : sql`AND coalesce(c.f_soluong, 0) > 0`;
    const rows = (await db.execute(sql`
      SELECT c.f_card_no AS card_no, c.f_soluong AS soluong, c.f_tenct_snap AS tenct, ${dalamCol}
      FROM tr_pallet_card c JOIN tr_pallet p ON p.f_id = c.f_pallet_id
      ${dalamJoin}
      WHERE p.company_id = ${cid}::uuid AND p.deleted_at IS NULL
        AND c.deleted_at IS NULL AND p.f_dondathang = ${dondathang} AND c.f_mact_snap = ${mact}
        ${concanCond}
      ORDER BY c.f_card_no LIMIT 500`)) as unknown as Record<string, unknown>[];
    return reply.send({ rows });
  });

  // ── Công đoạn tiếp theo (combobox) cho 1 công đoạn. Bảng cấu hình nguồn
  //    CongDoanTiepTheo (trtb_m_location_next) lưu FK theo OID TbMLocation —
  //    KHÔNG map sang bảng thật PG được. Dùng ROUTING THỰC TẾ: các *-IN đã từng
  //    nhận hàng từ công đoạn này (tr_trangthai_sanxuat), xếp theo tần suất —
  //    đúng tinh thần danh sách công đoạn kế tiếp. Không có congDoan → mọi -IN. ──
  app.get("/banvesvc/sl-next-stages", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const congDoan = ((req.query ?? {}) as { congDoan?: string }).congDoan?.trim() ?? "";
    const cid = auth.companyId;
    if (congDoan) {
      const rows = (await db.execute(sql`
        SELECT t.f_congdoantieptheo AS cloc, max(l.f_n_location) AS name, count(*) AS n
        FROM tr_trangthai_sanxuat t
        LEFT JOIN trtb_m_location l ON l.f_c_location = t.f_congdoantieptheo
        WHERE t.company_id = ${cid}::uuid AND t.deleted_at IS NULL
          AND t.f_congdoan = ${congDoan} AND t.f_congdoantieptheo LIKE '%-IN'
        GROUP BY t.f_congdoantieptheo ORDER BY count(*) DESC LIMIT 50`)) as unknown as Record<
        string,
        unknown
      >[];
      return reply.send({ rows });
    }
    const rows = (await db.execute(sql`
      SELECT f_c_location AS cloc, f_n_location AS name
      FROM trtb_m_location
      WHERE company_id = ${cid}::uuid AND deleted_at IS NULL AND f_c_location LIKE '%-IN'
      ORDER BY f_n_location`)) as unknown as Record<string, unknown>[];
    return reply.send({ rows });
  });

  // ── Báo cáo CHI PHÍ KINH DOANH theo nhóm (port ChiPhiKinhDoanhL). 70k dòng →
  //    group-by SERVER (cột f_ typed: id_nhomchiphi/ngaygiaodich/sotien/tygia).
  //    Tên nhóm = kt_nhom_chiphi.f_nhomchiphi; loại = KHOANCHI (chi)|KHOANTHU (thu);
  //    amount = sotien * (tygia=0?1:tygia). nhom rỗng=summary, có nhom=chi tiết. ──
  app.get("/banvesvc/chiphi", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const q = (req.query ?? {}) as { nam?: string; loai?: string; nhom?: string };
    const nam = (q.nam ?? "").trim();
    const loai = (q.loai ?? "").trim(); // KHOANCHI | KHOANTHU | ""
    const nhom = (q.nhom ?? "").trim();
    const cid = auth.companyId;
    const amount = sql`c.f_sotien * coalesce(nullif(c.f_tygia, 0), 1)`;
    const yearCond = nam ? sql`AND left(c.f_ngaygiaodich, 4) = ${nam}` : sql``;
    const loaiCond =
      loai === "KHOANCHI" || loai === "KHOANTHU" ? sql`AND c.f_loaichiphi = ${loai}` : sql``;
    if (!nhom) {
      const rows = (await db.execute(sql`
        SELECT c.f_id_nhomchiphi AS nhom_id, max(g.f_nhomchiphi) AS nhom,
               max(g.f_loaichiphi) AS loai, count(*) AS sl, sum(${amount}) AS tong
        FROM kt_chiphi_kinhdoanh c
        LEFT JOIN kt_nhom_chiphi g ON g.f_id = c.f_id_nhomchiphi
        WHERE c.company_id = ${cid}::uuid AND c.deleted_at IS NULL ${yearCond} ${loaiCond}
        GROUP BY c.f_id_nhomchiphi
        ORDER BY sum(${amount}) DESC NULLS LAST`)) as unknown as Record<string, unknown>[];
      return reply.send({ mode: "summary", rows });
    }
    const rows = (await db.execute(sql`
      SELECT left(c.f_ngaygiaodich, 10) AS ngay, c.f_tenchiphi AS tenchiphi,
             c.f_sotien AS sotien, c.f_tygia AS tygia, ${amount} AS amount,
             c.f_loaichiphi AS loai, c.f_nhacungcap AS nhacungcap, c.f_ghichu AS ghichu
      FROM kt_chiphi_kinhdoanh c
      WHERE c.company_id = ${cid}::uuid AND c.deleted_at IS NULL ${yearCond} ${loaiCond}
        AND c.f_id_nhomchiphi::text = ${nhom}
      ORDER BY c.f_ngaygiaodich DESC LIMIT 500`)) as unknown as Record<string, unknown>[];
    return reply.send({ mode: "detail", rows });
  });

  // ── Báo cáo KẾT QUẢ KINH DOANH / P&L (port KetQuaKinhDoanhL). Nguồn
  //    kt_ketqua_kinhdoanh (per tuần × bộ phận), kỳ lấy qua f_tuan →
  //    kt_ketqua_kinhdoanh_tuan.f_nam (KHÔNG dùng f_ngay — rỗng ở row có số).
  //    Thu/Chi/Lãi = f_tongthu/f_tongchi (cột typed). 3 mode: years | summary
  //    theo bộ phận | detail tuần. (Lưu ý: chỉ năm đã chốt tổng mới có số.) ──
  app.get("/banvesvc/kqkd", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const q = (req.query ?? {}) as { years?: string; nam?: string; bophan?: string };
    const cid = auth.companyId;
    if (q.years) {
      const rows = (await db.execute(sql`
        SELECT t.f_nam AS nam, count(*) AS n,
               sum(k.f_tongthu) AS thu, sum(k.f_tongchi) AS chi
        FROM kt_ketqua_kinhdoanh k
        JOIN kt_ketqua_kinhdoanh_tuan t ON t.f_id = k.f_tuan
        WHERE k.company_id = ${cid}::uuid AND k.deleted_at IS NULL
        GROUP BY t.f_nam ORDER BY t.f_nam DESC`)) as unknown as Record<string, unknown>[];
      return reply.send({ mode: "years", rows });
    }
    const nam = (q.nam ?? "").trim();
    const bophan = (q.bophan ?? "").trim();
    if (!bophan) {
      const rows = (await db.execute(sql`
        SELECT k.f_bophan AS bophan_id, max(b.f_name) AS bophan, count(*) AS sotuan,
               sum(k.f_tongthu) AS thu, sum(k.f_tongchi) AS chi,
               sum(k.f_tongthu - k.f_tongchi) AS lai
        FROM kt_ketqua_kinhdoanh k
        JOIN kt_ketqua_kinhdoanh_tuan t ON t.f_id = k.f_tuan
        LEFT JOIN kt_chiphi_bophan b ON b.f_id = k.f_bophan
        WHERE k.company_id = ${cid}::uuid AND k.deleted_at IS NULL AND t.f_nam::text = ${nam}
        GROUP BY k.f_bophan ORDER BY sum(k.f_tongthu - k.f_tongchi) ASC NULLS LAST`)) as unknown as Record<
        string,
        unknown
      >[];
      return reply.send({ mode: "summary", rows });
    }
    const rows = (await db.execute(sql`
      SELECT t.f_name AS tuan, left(t.f_denngay, 10) AS denngay,
             k.f_tongthu AS thu, k.f_tongchi AS chi, (k.f_tongthu - k.f_tongchi) AS lai,
             (coalesce(k.f_tienluonghc,0)+coalesce(k.f_tienluongtc,0)+coalesce(k.f_tiencomhc,0)
              +coalesce(k.f_tiencomtc,0)+coalesce(k.f_tienphucap,0)) AS luong,
             k.f_xuathang AS xuathang, k.f_khauhao AS khauhao, k.f_diennuoc AS diennuoc,
             k.f_tongcodinh AS tongcodinh, k.f_chiphoi AS chiphoi, k.f_thuphoi AS thuphoi
      FROM kt_ketqua_kinhdoanh k
      JOIN kt_ketqua_kinhdoanh_tuan t ON t.f_id = k.f_tuan
      WHERE k.company_id = ${cid}::uuid AND k.deleted_at IS NULL
        AND t.f_nam::text = ${nam} AND k.f_bophan = ${bophan}
      ORDER BY t.f_denngay`)) as unknown as Record<string, unknown>[];
    return reply.send({ mode: "detail", rows });
  });

  // ── Thông tin sản phẩm cho 4 tab ──
  app.get("/banvesvc/product", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const masp = ((req.query ?? {}) as { masp?: string }).masp?.trim() ?? "";
    if (!masp) return reply.send({ found: false });
    const cid = auth.companyId;

    const [spId, bvId, gvId, nkId] = await Promise.all([
      entityIdByName(db, cid, "tr_sanpham"),
      entityIdByName(db, cid, "tr_banve"),
      entityIdByName(db, cid, "tr_dinhmuc_govan"),
      entityIdByName(db, cid, "tr_dinhmuc_ngukim"),
    ]);

    // Tên sản phẩm
    let tensp: string | null = null;
    if (spId) {
      const sp = await listByMasp(db, cid, spId, masp, 1);
      tensp = (sp[0]?.data.tensp as string | null) ?? null;
    }

    // Bản vẽ (mọi loại active) — frontend tách theo phanloai cho 2 tab.
    const banve = bvId
      ? (await listByMasp(db, cid, bvId, masp)).flatMap((r) =>
          isActive(r.data.active) && r.data.filepath
            ? [{ id: r._id, phanloai: (r.data.phanloai as string | null) ?? "" }]
            : [],
        )
      : [];

    // Định mức gỗ ván (grid)
    const govan = gvId
      ? (await listByMasp(db, cid, gvId, masp)).map((r) => ({
          stt: r.data.stt ?? null,
          mact: r.data.mact ?? null,
          chitiet: r.data.chitiet ?? null,
          nguyenlieu: r.data.nguyenlieu ?? null,
          dayy_tc: r.data.dayy_tc ?? null,
          rong_tc: r.data.rong_tc ?? null,
          dai_tc: r.data.dai_tc ?? null,
          soluong_tc: r.data.soluong_tc ?? null,
          m3_tc: r.data.m3_tc ?? null,
          phoi_tructiep: r.data.phoi_tructiep ?? null,
          phoi_ghep: r.data.phoi_ghep ?? null,
          dayy_sc: r.data.dayy_sc ?? null,
          rong_sc: r.data.rong_sc ?? null,
          dai_sc: r.data.dai_sc ?? null,
          mong1: r.data.mong1 ?? null,
          mong2: r.data.mong2 ?? null,
          veneer_matchinh: r.data.veneer_matchinh ?? null,
          veneer_matphu: r.data.veneer_matphu ?? null,
          veneer_canhngan: r.data.veneer_canhngan ?? null,
          veneer_canhdai: r.data.veneer_canhdai ?? null,
          veneer_dan_canh: r.data.veneer_dan_canh ?? null,
          uv_matchinh: r.data.uv_matchinh ?? null,
          uv_matphu: r.data.uv_matphu ?? null,
          uv_canhdai: r.data.uv_canhdai ?? null,
          uv_canhngan: r.data.uv_canhngan ?? null,
          fsc_100: r.data.fsc_100 ?? null,
          fsc_mix: r.data.fsc_mix ?? null,
          fsc_cw: r.data.fsc_cw ?? null,
          ghichu: r.data.ghichu ?? null,
        }))
      : [];

    // Định mức ngũ kim (grid)
    const ngukim = nkId
      ? (await listByMasp(db, cid, nkId, masp)).map((r) => ({
          mavt: r.data.mavt ?? null,
          chitiet: r.data.chitiet ?? null,
          quycach: r.data.quycach ?? null,
          mausac: r.data.mausac ?? null,
          soluong: r.data.soluong ?? null,
          dvt: r.data.dvt ?? null,
          hwforai: r.data.hwforai ?? null,
          hwforww: r.data.hwforww ?? null,
          hwforpacking: r.data.hwforpacking ?? null,
          ghichu: r.data.ghichu ?? null,
        }))
      : [];

    return reply.send({ found: true, masp, tensp, banve, govan, ngukim });
  });

  // ── Resolve mã quét → masp ──
  app.get("/banvesvc/resolve", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const code = ((req.query ?? {}) as { code?: string }).code?.trim() ?? "";
    if (!code) return reply.send({ masp: "" });
    const cid = auth.companyId;

    let masp = "";
    if (code.includes(":")) {
      // Định dạng phiếu "MaDonHang:MaSanPham:MaChiTiet".
      masp = (code.split(":")[1] ?? "").replace(/\+/g, "_").trim();
    } else {
      // QR thẻ pallet → pallet.masp.
      const [cardId, palletId] = await Promise.all([
        entityIdByName(db, cid, "tr_pallet_card"),
        entityIdByName(db, cid, "tr_pallet"),
      ]);
      if (cardId && palletId) {
        const cards = await getRecordStore(db).list(cid, cardId, {
          filters: { card_no: { op: "=", value: code } },
          limit: 1,
          withTotal: false,
        });
        const pid = (cards.rows[0]?.data as Record<string, unknown> | undefined)?.pallet_id;
        if (pid != null) {
          const pl = await getRecordStore(db).list(cid, palletId, {
            filters: { id: { op: "=", value: String(pid) } },
            limit: 1,
            withTotal: false,
          });
          masp =
            ((pl.rows[0]?.data as Record<string, unknown> | undefined)?.masp as string | null) ??
            "";
        }
      }
    }

    // Fallback mã thay thế (tr_sanpham.masp_thaythe).
    if (masp) {
      const spId = await entityIdByName(db, cid, "tr_sanpham");
      if (spId) {
        const sp = await listByMasp(db, cid, spId, masp, 1);
        const thaythe = sp[0]?.data.masp_thaythe as string | null;
        if (thaythe?.trim()) masp = thaythe.trim();
      }
    }

    return reply.send({ masp });
  });

  // ── "Tìm sản phẩm" — tra theo Tên/Mã + Hệ hàng (port mode 1+text).
  //    masp/tensp/hehang là cột text typed → SQL trực tiếp an toàn (bind param). ──
  app.get("/banvesvc/search", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const q = ((req.query ?? {}) as { q?: string }).q?.trim() ?? "";
    const hehang = ((req.query ?? {}) as { hehang?: string }).hehang?.trim() ?? "";
    if (!q && !hehang) return reply.send({ rows: [] });
    const like = `%${q}%`;
    const rows = (await db.execute(
      sql`SELECT f_masp AS masp, f_tensp AS tensp, f_hehang AS hehang
          FROM tr_sanpham
          WHERE company_id = ${auth.companyId}::uuid AND deleted_at IS NULL
            AND (${q} = '' OR f_masp ILIKE ${like} OR f_tensp ILIKE ${like})
            AND (${hehang} = '' OR f_hehang = ${hehang})
          ORDER BY f_masp LIMIT 50`,
    )) as unknown as Array<Record<string, unknown>>;
    return reply.send({ rows });
  });

  // ── Danh sách Hệ hàng (cho dropdown "Theo hệ hàng") ──
  app.get("/banvesvc/hehang", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const q = ((req.query ?? {}) as { q?: string }).q?.trim() ?? "";
    const rows = (await db.execute(
      sql`SELECT DISTINCT f_hehang AS hehang FROM tr_sanpham
          WHERE company_id = ${auth.companyId}::uuid AND deleted_at IS NULL
            AND f_hehang IS NOT NULL AND f_hehang <> ''
            AND (${q} = '' OR f_hehang ILIKE ${`%${q}%`})
          ORDER BY f_hehang LIMIT 1000`,
    )) as unknown as Array<{ hehang: string }>;
    return reply.send({ rows: rows.map((r) => r.hehang) });
  });

  // ── Danh sách Đơn đặt hàng (maddh DQH-DQHF%/DQH-VFM%) cho "Theo đơn đặt hàng" ──
  app.get("/banvesvc/donhang", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const q = ((req.query ?? {}) as { q?: string }).q?.trim() ?? "";
    const rows = (await db.execute(
      sql`SELECT f_maddh AS maddh, f_tenddh AS tenddh FROM tr_dondathang
          WHERE company_id = ${auth.companyId}::uuid AND deleted_at IS NULL
            AND (f_maddh ILIKE 'DQH-DQHF%' OR f_maddh ILIKE 'DQH-VFM%')
            AND (${q} = '' OR f_maddh ILIKE ${`%${q}%`})
          ORDER BY f_maddh DESC LIMIT 800`,
    )) as unknown as Array<Record<string, unknown>>;
    return reply.send({ rows });
  });

  // ── Đơn hàng PO# (tr_order chưa hoàn thành) — finished là ext → getRecordStore. ──
  app.get("/banvesvc/order", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const oid = await entityIdByName(db, auth.companyId, "tr_order");
    if (!oid) return reply.send({ rows: [] });
    const out = await getRecordStore(db).list(auth.companyId, oid, {
      limit: 2000,
      withTotal: false,
    });
    const rows = out.rows
      .map((r) => r.data as Record<string, unknown>)
      .filter((d) => {
        const f = d.finished;
        return f == null || ["0", "false", "False"].includes(String(f));
      })
      .map((d) => ({ order_number: String(d.order_number ?? ""), customer: d.customer ?? null }))
      .filter((d) => d.order_number)
      .slice(0, 800);
    return reply.send({ rows });
  });

  // ── Sản phẩm trong 1 đơn hàng PO# (tr_order_detail.item_number = masp) ──
  app.get("/banvesvc/order-items", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const order = ((req.query ?? {}) as { order?: string }).order?.trim() ?? "";
    if (!order) return reply.send({ rows: [] });
    const odId = await entityIdByName(db, auth.companyId, "tr_order_detail");
    if (!odId) return reply.send({ rows: [] });
    const out = await getRecordStore(db).list(auth.companyId, odId, {
      filters: { order_number: { op: "=", value: order } },
      limit: 500,
      withTotal: false,
    });
    const seen = new Set<string>();
    const rows: Array<{ masp: string; description: unknown }> = [];
    for (const r of out.rows) {
      const d = r.data as Record<string, unknown>;
      const masp = String(d.item_number ?? "");
      if (masp && !seen.has(masp)) {
        seen.add(masp);
        rows.push({ masp, description: d.description ?? null });
      }
    }
    return reply.send({ rows });
  });

  // ── Sản phẩm trong 1 đơn đặt hàng (tr_dondathang_chitiet) ──
  app.get("/banvesvc/donhang-items", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const maddh = ((req.query ?? {}) as { maddh?: string }).maddh?.trim() ?? "";
    if (!maddh) return reply.send({ rows: [] });
    const rows = (await db.execute(
      sql`SELECT DISTINCT f_masp AS masp, f_tenchitiet AS tenchitiet FROM tr_dondathang_chitiet
          WHERE company_id = ${auth.companyId}::uuid AND deleted_at IS NULL
            AND f_maddh = ${maddh} AND f_masp IS NOT NULL AND f_masp <> ''
          ORDER BY f_masp LIMIT 200`,
    )) as unknown as Array<Record<string, unknown>>;
    return reply.send({ rows });
  });

  // ── Mở file PDF của 1 bản vẽ (serve tại chỗ hoặc 302 viewer PDF.js) ──
  app.get("/banvesvc/file", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;

    const { id, raw } = (req.query ?? {}) as { id?: string; raw?: string };
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return reply.code(400).send({ error: "Thiếu hoặc sai id bản vẽ" });
    }

    const rows = (await db.execute(
      sql`SELECT f_filepath AS filepath FROM tr_banve
          WHERE id = ${id}::uuid AND company_id = ${auth.companyId}::uuid AND deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as Array<{ filepath: string | null }>;
    const rel = rows[0]?.filepath;
    if (!rel) return reply.code(404).send({ error: "Bản vẽ không tồn tại hoặc không có file" });

    const base = process.env.BANVE_FILES_DIR;
    const baseReal = base ? await realpath(base).catch(() => null) : null;
    if (baseReal) {
      const cleaned = rel.replace(/\\/g, "/").replace(/^\/+/, "");
      const target = resolvePath(baseReal, cleaned);
      const real = await realpath(target).catch(() => null);
      if (real && (real === baseReal || real.startsWith(baseReal + sep))) {
        const st = await stat(real).catch(() => null);
        if (st?.isFile()) {
          const fileName = cleaned.split("/").pop() || "banve.pdf";
          const mime = mimeByExt(fileName);
          reply
            .type(mime)
            .header(
              "content-disposition",
              `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
            )
            .header("cache-control", "private, max-age=300")
            .header("x-content-type-options", "nosniff");
          // SVG/HTML (vd bản vẽ AI) có thể nhúng script → chặn thực thi khi
          // xem trong iframe (defense-in-depth, song song iframe sandbox FE).
          if (mime.startsWith("image/svg") || mime.startsWith("text/html")) {
            reply.header(
              "content-security-policy",
              "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'none'",
            );
          }
          return reply.send(createReadStream(real));
        }
      }
    }

    // Không có file cục bộ (vd prod chưa mount BANVE_FILES_DIR). raw=1 (pdfjs
    // phía client CẦN bytes PDF thô) → server PROXY bytes từ file-server ngoài,
    // KHÔNG 302 sang viewer HTML (pdfjs theo redirect sẽ nhận HTML viewer, không
    // phải PDF → "Chưa có bản vẽ"). Mặc định (iframe trình xem mobile) GIỮ
    // NGUYÊN redirect viewer PDF.js để không đổi UX màn xem.
    if (String(raw ?? "") === "1") {
      const fileName = rel.replace(/\\/g, "/").split("/").pop() || "banve.pdf";
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25_000);
      try {
        const upstream = await fetch(pdfRawUrl(rel), { signal: ctrl.signal, redirect: "follow" });
        if (!upstream.ok || !upstream.body) {
          return reply.code(502).send({ error: `File-server trả ${upstream.status}` });
        }
        const mime = mimeByExt(fileName);
        reply
          .type(mime)
          .header("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`)
          .header("cache-control", "private, max-age=300")
          .header("x-content-type-options", "nosniff");
        return reply.send(
          Readable.fromWeb(upstream.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
        );
      } catch {
        return reply.code(502).send({ error: "Không tải được file bản vẽ từ file-server" });
      } finally {
        clearTimeout(timer);
      }
    }

    return reply.redirect(pdfViewerUrl(rel, req.headers.host));
  });

  // ── Mô hình 3D / artifact phụ của 1 bản vẽ AI (STL/STEP/PNG) ──
  //    Bản vẽ AI lưu file 2D vào tr_banve.filepath = "<dir>/cad-<stamp>.svg";
  //    artifact phụ cùng thư mục: cad-<stamp>-model.stl / -model.step /
  //    -preview.png (xem cad-persist.ts). Dẫn xuất sibling từ filepath rồi
  //    serve (chống path-traversal y như /file). Không có → 404.
  app.get("/banvesvc/model", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const { id, kind } = (req.query ?? {}) as { id?: string; kind?: string };
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return reply.code(400).send({ error: "Thiếu hoặc sai id bản vẽ" });
    }
    const k = kind === "step" ? "step" : kind === "png" ? "png" : "stl";

    const rows = (await db.execute(
      sql`SELECT f_filepath AS filepath FROM tr_banve
          WHERE id = ${id}::uuid AND company_id = ${auth.companyId}::uuid AND deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as Array<{ filepath: string | null }>;
    const rel = rows[0]?.filepath;
    if (!rel) return reply.code(404).send({ error: "Bản vẽ không tồn tại" });

    const base = process.env.BANVE_FILES_DIR;
    const baseReal = base ? await realpath(base).catch(() => null) : null;
    if (!baseReal) return reply.code(404).send({ error: "Chưa cấu hình kho file bản vẽ" });

    const suffix = k === "step" ? "-model.step" : k === "png" ? "-preview.png" : "-model.stl";
    // Bỏ đuôi file 2D rồi nối suffix artifact.
    const cleaned =
      rel
        .replace(/\\/g, "/")
        .replace(/^\/+/, "")
        .replace(/\.[^./]+$/, "") + suffix;
    const target = resolvePath(baseReal, cleaned);
    const real = await realpath(target).catch(() => null);
    if (!real || !(real === baseReal || real.startsWith(baseReal + sep))) {
      return reply.code(404).send({ error: "Không tìm thấy mô hình" });
    }
    const st = await stat(real).catch(() => null);
    if (!st?.isFile()) {
      return reply.code(404).send({ error: "Bản vẽ này chưa có mô hình 3D" });
    }
    const fileName = cleaned.split("/").pop() || `model.${k}`;
    const ct = k === "png" ? "image/png" : k === "step" ? "application/step" : "model/stl";
    reply
      .type(ct)
      .header(
        "content-disposition",
        `${k === "step" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      )
      .header("cache-control", "private, max-age=300")
      .header("x-content-type-options", "nosniff");
    return reply.send(createReadStream(real));
  });

  // ── Danh sách chi tiết đóng gói theo masp (tr_dinhmuc_donggoi) ──
  //    Dùng cho trang desktop "Bản vẽ đóng gói": cột trái hiển thị chi tiết SP.
  //    Trả thêm mausac (từ tr_sanpham) và thông tin sản phẩm.
  app.get("/banvesvc/donggoi-chitiet", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const masp = ((req.query ?? {}) as { masp?: string }).masp?.trim() ?? "";
    if (!masp) return reply.send({ masp, mausac: null, tensp: null, rows: [] });

    const cid = auth.companyId;
    const [dgId, spId] = await Promise.all([
      entityIdByName(db, cid, "tr_dinhmuc_donggoi"),
      entityIdByName(db, cid, "tr_sanpham"),
    ]);

    // Lấy mausac + tensp từ tr_sanpham
    let mausac: string | null = null;
    let tensp: string | null = null;
    if (spId) {
      const sp = await listByMasp(db, cid, spId, masp, 1);
      mausac = (sp[0]?.data.mausac as string | null) ?? null;
      tensp = (sp[0]?.data.tensp as string | null) ?? null;
    }

    if (!dgId) return reply.send({ masp, mausac, tensp, rows: [] });

    const out = await listByMasp(db, cid, dgId, masp, 500);
    const rows = out.map((r) => ({
      stt: r.data.stt ?? null,
      ccode: r.data.ccode ?? null,
      chitiet: r.data.chitiet ?? null,
      quycach: r.data.quycach ?? null,
      soluong: r.data.soluong ?? null,
      dvt: r.data.dvt ?? null,
      ghichu: r.data.ghichu ?? null,
      nhom: r.data.nhom ?? null,
    }));
    return reply.send({ masp, mausac, tensp, rows });
  });

  // ── Danh sách tất cả sản phẩm theo hệ hàng (cho trang bản vẽ kỹ thuật) ──
  //    Dùng cùng cột typed như /banvesvc/search — KHÔNG dùng ext (tr_sanpham có thể
  //    không có cột ext). Thêm f_khachhang nếu tồn tại, fallback NULL an toàn.
  app.get("/banvesvc/sanpham-by-hehang", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const hehang = ((req.query ?? {}) as { hehang?: string }).hehang?.trim() ?? "";
    if (!hehang) return reply.send({ rows: [] });
    const cid = auth.companyId;
    const rows = (await db.execute(
      sql`SELECT f_masp AS masp, f_tensp AS tensp, f_hehang AS hehang
          FROM tr_sanpham
          WHERE company_id = ${cid}::uuid AND deleted_at IS NULL
            AND f_hehang = ${hehang}
          ORDER BY f_masp LIMIT 500`,
    )) as unknown as Array<Record<string, unknown>>;
    return reply.send({ rows });
  });

  // ── Danh sách bản vẽ đầy đủ theo masp + phanloai (cho trang desktop) ──
  app.get("/banvesvc/banve-list", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const q = (req.query ?? {}) as { masp?: string; phanloai?: string };
    const masp = q.masp?.trim() ?? "";
    const phanloai = q.phanloai?.trim() ?? "";
    if (!masp) return reply.send({ rows: [] });
    const cid = auth.companyId;
    const phanloaiCond = phanloai ? sql`AND f_phanloai = ${phanloai}` : sql``;
    const rows = (await db.execute(
      sql`SELECT id::text AS id, f_masp AS masp, f_tensp AS tensp, f_hehang AS hehang,
                 f_phanloai AS phanloai, f_filepath AS filepath,
                 COALESCE(ext->>'seq1', f_seq1) AS seq1,
                 COALESCE(ext->>'seq2', f_seq2) AS seq2,
                 COALESCE(ext->>'khachhang', f_khachhang) AS khachhang,
                 f_active AS active,
                 created_at::date::text AS create_date,
                 updated_at::date::text AS update_date
          FROM tr_banve
          WHERE company_id = ${cid}::uuid AND deleted_at IS NULL
            AND f_masp = ${masp} ${phanloaiCond}
            AND (f_active IS DISTINCT FROM FALSE)
          ORDER BY created_at DESC LIMIT 200`,
    )) as unknown as Array<Record<string, unknown>>;
    return reply.send({ rows });
  });

  // ── Tạo mới bản vẽ (file đã upload qua /upload/file trước) ──
  app.post("/banvesvc/banve-create", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const body = (req.body ?? {}) as {
      masp?: string;
      tensp?: string;
      hehang?: string;
      khachhang?: string;
      phanloai?: string;
      filepath?: string;
      seq1?: string;
      seq2?: string;
    };
    const {
      masp,
      tensp = "",
      hehang = "",
      khachhang = "",
      phanloai = "Bản vẽ kỹ thuật",
      filepath = "",
      seq1 = "",
      seq2 = "",
    } = body;
    if (!masp || !filepath) {
      return reply.code(400).send({ error: "Thiếu mã sản phẩm hoặc file bản vẽ" });
    }
    const cid = auth.companyId;
    const bvId = await entityIdByName(db, cid, "tr_banve");
    if (!bvId) return reply.code(500).send({ error: "Không tìm thấy entity tr_banve" });
    const row = await getRecordStore(db).insert(
      cid,
      bvId,
      { masp, tensp, hehang, khachhang, phanloai, filepath, seq1, seq2, active: true },
      auth.userId,
    );
    return reply.send({ id: row?.id ?? null, ok: true });
  });

  // ── Xóa mềm 1 bản vẽ ──
  app.delete("/banvesvc/banve-delete", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const id = ((req.query ?? {}) as { id?: string }).id?.trim() ?? "";
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return reply.code(400).send({ error: "Thiếu hoặc sai id" });
    }
    await db.execute(
      sql`UPDATE tr_banve SET deleted_at = now()
          WHERE id = ${id}::uuid AND company_id = ${auth.companyId}::uuid AND deleted_at IS NULL`,
    );
    return reply.send({ ok: true });
  });

  // ── Danh sách sản phẩm có bản vẽ đóng gói theo hệ hàng ──
  //    Dùng cho trang desktop: filter hệ hàng → chọn SP → xem chi tiết + PDF tr2.
  app.get("/banvesvc/donggoi-sanpham", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const hehang = ((req.query ?? {}) as { hehang?: string }).hehang?.trim() ?? "";
    const cid = auth.companyId;

    // Lấy danh sách masp có bản vẽ đóng gói (phanloai = 'Bản vẽ đóng gói', active)
    // JOIN với tr_sanpham lấy tensp + hehang.
    const rows = (await db.execute(
      sql`SELECT DISTINCT b.f_masp AS masp, max(b.f_tensp) AS tensp,
                 max(b.f_hehang) AS hehang, max(b.id::text) AS banve_id,
                 max(b.f_filepath) AS filepath
          FROM tr_banve b
          WHERE b.company_id = ${cid}::uuid AND b.deleted_at IS NULL
            AND b.f_phanloai = 'Bản vẽ đóng gói'
            AND (b.f_active IS DISTINCT FROM FALSE)
            AND (${hehang} = '' OR b.f_hehang = ${hehang})
          GROUP BY b.f_masp
          ORDER BY b.f_masp LIMIT 500`,
    )) as unknown as Array<Record<string, unknown>>;

    return reply.send({
      rows: rows.map((r) => ({
        masp: String(r.masp ?? ""),
        tensp: r.tensp ?? null,
        hehang: r.hehang ?? null,
        banve_id: r.banve_id ?? null,
        filepath: r.filepath ?? null,
      })),
    });
  });
}
