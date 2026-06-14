/* ==========================================================
   drawing-routes.ts — Tra + xem bản vẽ (màn XAF SanPham_DetailView_XemBanVe,
   DQHF252) cho trang mobile xưởng. Master = sản phẩm (masp), 4 tab:
     - Bản vẽ        : tr_banve PDF (phanloai = loại chọn, ≠ 'Bản vẽ dao')
     - Bản vẽ dao    : tr_banve PDF (phanloai LIKE 'Bản vẽ dao%')
     - Định mức gỗ ván: grid tr_dinhmuc_govan theo masp
     - Định mức ngũ kim: grid tr_dinhmuc_ngukim theo masp

   Endpoint (auth session cookie → company → view:entity):
     GET /banve/product?masp=  → JSON {tensp, banve[], govan[], ngukim[]}
     GET /banve/resolve?code=  → JSON {masp}  (QR thẻ pallet / "Đơn:SP:CT" +
                                  fallback masp_thaythe)
     GET /banve/file?id=       → stream PDF (local) hoặc 302 viewer PDF.js.

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
  // ── Thông tin sản phẩm cho 4 tab ──
  app.get("/banve/product", async (req, reply) => {
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
  app.get("/banve/resolve", async (req, reply) => {
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

  // ── Mở file PDF của 1 bản vẽ (serve tại chỗ hoặc 302 viewer PDF.js) ──
  app.get("/banve/file", async (req, reply) => {
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
