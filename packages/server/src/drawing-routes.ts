/* ==========================================================
   drawing-routes.ts — Tra + stream bản vẽ (ngoài tRPC) cho trang mobile xưởng.
   - GET /banve/lookup?masp=&type=  → JSON [{id,tensp,hehang,phanloai}] bản vẽ
     active khớp mã sản phẩm (+ tuỳ chọn loại bản vẽ phanloai).
   - GET /banve/file?id=<uuid>      → stream PDF của 1 bản vẽ.
   Auth: session cookie → company → roleCan("view","entity").

   Bảo mật: filepath KHÔNG nhận từ client — lấy từ chính record `tr_banve`
   (company-scoped) làm whitelist; chống path traversal + symlink escape. File
   nằm dưới thư mục mount BANVE_FILES_DIR. filepath nguồn không đồng nhất
   (backslash Windows + forward slash, gốc FileBanVe/ hoặc wwwroot/Ban_Ve/...)
   → normalize `\`→`/` trước khi join.
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

/** Auth phiên (cookie) → company + RBAC đọc entity. Trả {companyId,userId} hoặc
 *  null (đã gửi response lỗi). */
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

export function registerDrawingRoutes(app: FastifyInstance, db: DB): void {
  // ── Tra bản vẽ theo mã sản phẩm (+ loại) ──
  app.get("/banve/lookup", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;
    const q = (req.query ?? {}) as { masp?: string; type?: string };
    const masp = (q.masp ?? "").trim();
    if (!masp) return reply.send({ rows: [] });
    const type = (q.type ?? "").trim();
    const rows = (await db.execute(
      sql`SELECT id, f_tensp AS tensp, f_hehang AS hehang, f_phanloai AS phanloai
          FROM tr_banve
          WHERE company_id = ${auth.companyId}::uuid AND deleted_at IS NULL
            AND lower(f_masp) = lower(${masp})
            AND coalesce(f_active::text, '1') NOT IN ('0', 'false')
            AND f_filepath IS NOT NULL AND f_filepath <> ''
            AND (${type} = '' OR f_phanloai = ${type})
          ORDER BY f_create_date DESC NULLS LAST
          LIMIT 50`,
    )) as unknown as Array<Record<string, unknown>>;
    return reply.send({ rows });
  });

  // ── Stream file PDF của 1 bản vẽ ──
  app.get("/banve/file", async (req, reply) => {
    const auth = await authView(db, req, reply);
    if (!auth) return;

    const { id } = (req.query ?? {}) as { id?: string };
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return reply.code(400).send({ error: "Thiếu hoặc sai id bản vẽ" });
    }

    const base = process.env.BANVE_FILES_DIR;
    if (!base) {
      return reply
        .code(503)
        .send({ error: "Server chưa cấu hình BANVE_FILES_DIR (mount file bản vẽ)" });
    }
    const baseReal = await realpath(base).catch(() => null);
    if (!baseReal) return reply.code(503).send({ error: "BANVE_FILES_DIR không truy cập được" });

    // Lấy filepath TỪ record tr_banve (whitelist + company-scoped).
    const rows = (await db.execute(
      sql`SELECT f_filepath AS filepath FROM tr_banve
          WHERE id = ${id}::uuid AND company_id = ${auth.companyId}::uuid AND deleted_at IS NULL
          LIMIT 1`,
    )) as unknown as Array<{ filepath: string | null }>;
    const rel = rows[0]?.filepath;
    if (!rel) return reply.code(404).send({ error: "Bản vẽ không tồn tại hoặc không có file" });

    // Normalize `\`→`/`, bỏ '/' đầu; chống traversal + symlink escape.
    const cleaned = rel.replace(/\\/g, "/").replace(/^\/+/, "");
    const target = resolvePath(baseReal, cleaned);
    let real: string;
    try {
      real = await realpath(target);
    } catch {
      return reply.code(404).send({ error: "File bản vẽ không tìm thấy trên server" });
    }
    if (real !== baseReal && !real.startsWith(baseReal + sep)) {
      return reply.code(403).send({ error: "Đường dẫn không hợp lệ" });
    }
    const st = await stat(real).catch(() => null);
    if (!st?.isFile()) return reply.code(404).send({ error: "File không tồn tại" });

    const fileName = cleaned.split("/").pop() || "banve.pdf";
    reply
      .type("application/pdf")
      .header("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`)
      .header("cache-control", "private, max-age=300");
    return reply.send(createReadStream(real));
  });
}
