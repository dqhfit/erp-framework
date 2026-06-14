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

/** URL viewer PDF.js — port y hệt FnSanPham.GetLinkViewPDFFile. */
function pdfViewerUrl(filepath: string): string {
  const base = process.env.BANVE_PDFJS_BASE ?? "https://view.dongquochung.com:4432";
  const value = encodeURIComponent(filepath.replace(/\\/g, "/")).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${base.replace(/\/+$/, "")}/web/viewer.html?file=/f/${value}`;
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
          chitiet: r.data.chitiet ?? null,
          nguyenlieu: r.data.nguyenlieu ?? null,
          dayy_tc: r.data.dayy_tc ?? null,
          rong_tc: r.data.rong_tc ?? null,
          dai_tc: r.data.dai_tc ?? null,
          soluong: r.data.soluong_tc ?? null,
        }))
      : [];

    // Định mức ngũ kim (grid)
    const ngukim = nkId
      ? (await listByMasp(db, cid, nkId, masp)).map((r) => ({
          mavt: r.data.mavt ?? null,
          chitiet: r.data.chitiet ?? null,
          quycach: r.data.quycach ?? null,
          soluong: r.data.soluong ?? null,
          dvt: r.data.dvt ?? null,
          hwforai: r.data.hwforai ?? null,
          hwforww: r.data.hwforww ?? null,
          hwforpacking: r.data.hwforpacking ?? null,
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

    const { id } = (req.query ?? {}) as { id?: string };
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
          reply
            .type("application/pdf")
            .header(
              "content-disposition",
              `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
            )
            .header("cache-control", "private, max-age=300");
          return reply.send(createReadStream(real));
        }
      }
    }
    return reply.redirect(pdfViewerUrl(rel));
  });
}
