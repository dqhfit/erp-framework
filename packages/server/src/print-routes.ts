/* ==========================================================
   print-routes.ts — Route nhị phân /print/:id (ngoài tRPC).
   GET /print/:id?format=html|pdf&<params> → render template + data
   (rows từ dataProcedure) → HTML in-ready (mặc định) hoặc PDF (Puppeteer
   nếu cài Chromium; thiếu → fallback HTML + header x-print-fallback).
   Auth: session cookie → company → roleCan("run","procedure").
   ========================================================== */

import { type Role, roleCan } from "@erp-framework/core";
import { printTemplates, sessions } from "@erp-framework/db";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { SESSION_COOKIE } from "./auth";
import { resolveActiveCompany } from "./context";
import type { DB } from "./db";
import { makeCallTool } from "./mcp-client";
import { makeInvokeProcedure } from "./procedure-runner";
import { PdfEngineUnavailableError, htmlToPdf, renderTemplate } from "./print-render";

export function registerPrintRoutes(app: FastifyInstance, db: DB): void {
  app.get("/print/:id", async (req, reply) => {
    const sid = (req.cookies as Record<string, string | undefined>)?.[SESSION_COOKIE];
    if (!sid) return reply.code(401).send({ error: "Chưa đăng nhập" });
    const [s] = await db.select().from(sessions).where(eq(sessions.id, sid));
    if (!s || s.expiresAt < new Date()) return reply.code(401).send({ error: "Phiên hết hạn" });
    const active = await resolveActiveCompany(db, s.userId, s.activeCompanyId);
    if (!active) return reply.code(403).send({ error: "Bạn chưa thuộc công ty nào" });
    if (!roleCan(active.role as Role, "run", "procedure")) {
      return reply.code(403).send({ error: 'Vai trò không có quyền "run:procedure"' });
    }

    const { id } = req.params as { id: string };
    const rawQ = (req.query ?? {}) as Record<string, string>;
    // Chỉ giữ key hợp lệ (a-z0-9_) và lọc value chứa HTML tag.
    // Ngăn attacker truyền key tùy ý hoặc giá trị XSS qua {{{raw}}} trong template.
    const q: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawQ)) {
      if (/^[a-z0-9_]+$/i.test(k) && typeof v === "string" && !/<[^>]*>/i.test(v)) {
        q[k] = v;
      }
    }
    const [tpl] = await db
      .select()
      .from(printTemplates)
      .where(and(eq(printTemplates.companyId, active.companyId), eq(printTemplates.id, id)))
      .limit(1);
    if (!tpl) return reply.code(404).send({ error: "Template không tồn tại" });

    // Lấy rows từ dataProcedure (nếu có), truyền query params làm args.
    let rows: unknown[] = [];
    if (tpl.dataProcedure) {
      const invoke = makeInvokeProcedure({
        db,
        companyId: active.companyId,
        callTool: makeCallTool(db, active.companyId),
        actorUserId: s.userId,
      });
      const args: Record<string, string> = { ...q };
      delete args.format;
      try {
        const out = (await invoke(tpl.dataProcedure, args)) as
          | unknown[]
          | { rows?: unknown[]; data?: unknown[] };
        rows = Array.isArray(out) ? out : (out?.rows ?? out?.data ?? []);
      } catch (e) {
        return reply.code(500).send({ error: `Lỗi chạy proc dữ liệu: ${(e as Error).message}` });
      }
    }

    const html = renderTemplate(tpl.html, { rows, ...q });

    if (q.format === "pdf") {
      try {
        const buf = await htmlToPdf(html, {
          pageSize: tpl.pageSize,
          orientation: tpl.orientation as "portrait" | "landscape",
        });
        reply
          .type("application/pdf")
          .header("content-disposition", `inline; filename="${tpl.name}.pdf"`)
          .send(buf);
        return;
      } catch (e) {
        if (e instanceof PdfEngineUnavailableError) {
          // Fallback: trả HTML để in từ trình duyệt; báo qua header.
          reply
            .header("x-print-fallback", "html-no-chromium")
            .type("text/html; charset=utf-8")
            .send(html);
          return;
        }
        throw e;
      }
    }

    reply.type("text/html; charset=utf-8").send(html);
  });
}
