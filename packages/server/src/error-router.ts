/* ==========================================================
   error-router.ts — Thu thập + theo dõi lỗi phía client.

   - report (approvedProcedure, rate-limit): app tự gửi lỗi runtime
     (window.onerror / unhandledrejection / React ErrorBoundary) về.
     GOM TRÙNG theo fingerprint (server tính từ level + message) qua
     ON CONFLICT DO UPDATE: lỗi lặp lại chỉ tăng count + last_seen,
     KHÔNG đẻ dòng mới (chống ngập DB). Lỗi đã "resolved" mà tái phát
     thì tự mở lại (open); "ignored" giữ nguyên.
   - list/get/setStatus/delete/clearResolved/stats: ADMIN-only — giao
     diện /settings/errors. MCP server (mcp-errors.ts) cho AI dùng lại
     cùng logic (scope errors:read|write).
   ========================================================== */

import { createHash } from "node:crypto";
import { clientErrors } from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { logActivity } from "./activity";
import { approvedProcedure, rateLimit, router } from "./trpc";

const ZLevel = z.enum(["error", "warn"]);
const ZStatus = z.enum(["open", "resolved", "ignored"]);
const ZSource = z.enum(["window.onerror", "unhandledrejection", "react", "manual", "unknown"]);

/** Fingerprint gom trùng: cùng level + message (đã chuẩn hoá) → 1 dòng.
 *  KHÔNG dùng stack vì bundle minified đổi theo mỗi lần build → fingerprint
 *  theo stack sẽ phân mảnh. message gộp khoảng trắng + cắt 500 ký tự. */
export function computeFingerprint(level: string, message: string): string {
  const norm = message.replace(/\s+/g, " ").trim().slice(0, 500);
  return createHash("sha256").update(`${level}|${norm}`).digest("hex").slice(0, 32);
}

/** Chặn admin-only — dùng cho mọi endpoint theo dõi/triage. */
function assertAdmin(role: string): void {
  if (role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Chỉ admin được theo dõi lỗi" });
  }
}

export const errorRouter = router({
  /* ── Ingest: app gửi lỗi về (mọi user đã duyệt) ───────────────── */
  report: approvedProcedure
    // 240 lỗi/phút/IP — đủ cho burst nhưng chặn vòng lặp lỗi spam server.
    .use(rateLimit("errors.report", 240, 60_000))
    .input(
      z.object({
        message: z.string().min(1).max(4000),
        stack: z.string().max(20_000).optional(),
        componentStack: z.string().max(20_000).optional(),
        source: ZSource.optional(),
        level: ZLevel.optional(),
        url: z.string().max(2000).optional(),
        userAgent: z.string().max(1000).optional(),
        meta: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const level = input.level ?? "error";
      const fingerprint = computeFingerprint(level, input.message);
      const now = new Date();
      await ctx.db
        .insert(clientErrors)
        .values({
          companyId: ctx.user.companyId,
          userId: ctx.user.id,
          fingerprint,
          level,
          source: input.source ?? "unknown",
          message: input.message,
          stack: input.stack ?? null,
          componentStack: input.componentStack ?? null,
          url: input.url ?? null,
          userAgent: input.userAgent ?? null,
          meta: input.meta ?? null,
          status: "open",
          count: 1,
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: [clientErrors.companyId, clientErrors.fingerprint],
          set: {
            count: sql`${clientErrors.count} + 1`,
            lastSeenAt: now,
            updatedAt: now,
            // Cập nhật ngữ cảnh mới nhất.
            message: input.message,
            stack: input.stack ?? null,
            componentStack: input.componentStack ?? null,
            url: input.url ?? null,
            userAgent: input.userAgent ?? null,
            source: input.source ?? "unknown",
            userId: ctx.user.id,
            // Lỗi đã fix (resolved) mà tái phát → tự mở lại; ignored giữ nguyên.
            status: sql`CASE WHEN ${clientErrors.status} = 'resolved' THEN 'open' ELSE ${clientErrors.status} END`,
          },
        });
      // Fire-and-forget cho client — không cần trả dữ liệu.
      return { ok: true };
    }),

  /* ── Admin: danh sách lỗi (theo dõi/triage) ───────────────────── */
  list: approvedProcedure
    .input(
      z
        .object({
          status: ZStatus.optional(),
          level: ZLevel.optional(),
          q: z.string().max(200).optional(),
          limit: z.number().int().positive().max(500).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      assertAdmin(ctx.user.role);
      const conds = [eq(clientErrors.companyId, ctx.user.companyId)];
      if (input?.status) conds.push(eq(clientErrors.status, input.status));
      if (input?.level) conds.push(eq(clientErrors.level, input.level));
      if (input?.q?.trim()) conds.push(ilike(clientErrors.message, `%${input.q.trim()}%`));
      return ctx.db
        .select({
          id: clientErrors.id,
          level: clientErrors.level,
          source: clientErrors.source,
          message: clientErrors.message,
          url: clientErrors.url,
          status: clientErrors.status,
          count: clientErrors.count,
          userId: clientErrors.userId,
          firstSeenAt: clientErrors.firstSeenAt,
          lastSeenAt: clientErrors.lastSeenAt,
        })
        .from(clientErrors)
        .where(and(...conds))
        .orderBy(desc(clientErrors.lastSeenAt))
        .limit(input?.limit ?? 200);
    }),

  get: approvedProcedure.input(z.string().uuid()).query(async ({ ctx, input }) => {
    assertAdmin(ctx.user.role);
    const [row] = await ctx.db
      .select()
      .from(clientErrors)
      .where(and(eq(clientErrors.id, input), eq(clientErrors.companyId, ctx.user.companyId)));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Lỗi không tồn tại" });
    return row;
  }),

  /* ── Admin: đổi trạng thái hàng loạt ──────────────────────────── */
  setStatus: approvedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(500), status: ZStatus }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.user.role);
      const res = await ctx.db
        .update(clientErrors)
        .set({ status: input.status, updatedAt: new Date() })
        .where(
          and(eq(clientErrors.companyId, ctx.user.companyId), inArray(clientErrors.id, input.ids)),
        )
        .returning({ id: clientErrors.id });
      return { ok: true, updated: res.length };
    }),

  /* ── Admin: xoá hẳn (hard delete) ─────────────────────────────── */
  delete: approvedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx.user.role);
      const res = await ctx.db
        .delete(clientErrors)
        .where(
          and(eq(clientErrors.companyId, ctx.user.companyId), inArray(clientErrors.id, input.ids)),
        )
        .returning({ id: clientErrors.id });
      void logActivity(ctx.db, {
        companyId: ctx.user.companyId,
        kind: "error.delete",
        target: input.ids.join(","),
        detail: `Xoá ${res.length} lỗi`,
        actorUserId: ctx.user.id,
      });
      return { ok: true, deleted: res.length };
    }),

  /** Xoá tất cả lỗi đã resolved — dọn nhanh. */
  clearResolved: approvedProcedure.mutation(async ({ ctx }) => {
    assertAdmin(ctx.user.role);
    const res = await ctx.db
      .delete(clientErrors)
      .where(
        and(eq(clientErrors.companyId, ctx.user.companyId), eq(clientErrors.status, "resolved")),
      )
      .returning({ id: clientErrors.id });
    void logActivity(ctx.db, {
      companyId: ctx.user.companyId,
      kind: "error.clear_resolved",
      target: "",
      detail: `Xoá ${res.length} lỗi đã xử lý`,
      actorUserId: ctx.user.id,
    });
    return { ok: true, deleted: res.length };
  }),

  /* ── Admin: thống kê đếm theo trạng thái (cho badge UI) ───────── */
  stats: approvedProcedure.query(async ({ ctx }) => {
    assertAdmin(ctx.user.role);
    const rows = await ctx.db
      .select({ status: clientErrors.status, n: sql<number>`count(*)::int` })
      .from(clientErrors)
      .where(eq(clientErrors.companyId, ctx.user.companyId))
      .groupBy(clientErrors.status);
    const out = { open: 0, resolved: 0, ignored: 0, total: 0 };
    for (const r of rows) {
      const n = Number(r.n) || 0;
      if (r.status === "open") out.open = n;
      else if (r.status === "resolved") out.resolved = n;
      else if (r.status === "ignored") out.ignored = n;
      out.total += n;
    }
    return out;
  }),
});
