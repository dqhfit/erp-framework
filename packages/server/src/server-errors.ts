/* ==========================================================
   server-errors.ts — Ghi lỗi PHÍA SERVER vào bảng client_errors
   (source="server") để admin xem CHUNG với lỗi client ở /settings/errors
   và AI đọc qua MCP /mcp/errors. Gom trùng theo fingerprint y như lỗi
   client (computeFingerprint dùng chung error-router.ts).

   Ràng buộc: client_errors.company_id NOT NULL → CHỈ ghi khi biết
   companyId (lỗi không có ngữ cảnh tenant → caller chỉ structured-log).
   Fail-safe: lỗi lúc ghi KHÔNG được làm vỡ caller (đang ở đường lỗi).
   ========================================================== */
import { clientErrors } from "@erp-framework/db";
import { sql } from "drizzle-orm";
import type { DB } from "./db";
import { computeFingerprint } from "./error-router";

export interface ServerErrorInput {
  companyId: string;
  message: string;
  stack?: string | null;
  /** Route/path nơi phát sinh (để triage). */
  url?: string | null;
  userId?: string | null;
  meta?: Record<string, unknown> | null;
}

/** Ghi 1 lỗi server vào client_errors (source="server"). Gom trùng theo
 *  (companyId, fingerprint): lỗi lặp chỉ tăng count + last_seen. Fail-safe. */
export async function recordServerError(db: DB, e: ServerErrorInput): Promise<void> {
  try {
    const message = e.message.slice(0, 4000);
    const fingerprint = computeFingerprint("error", message);
    const stack = e.stack?.slice(0, 20_000) ?? null;
    const url = e.url?.slice(0, 2000) ?? null;
    const now = new Date();
    await db
      .insert(clientErrors)
      .values({
        companyId: e.companyId,
        userId: e.userId ?? null,
        fingerprint,
        level: "error",
        source: "server",
        message,
        stack,
        url,
        meta: e.meta ?? null,
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
          message,
          stack,
          url,
          userId: e.userId ?? null,
          // Lỗi đã "resolved" mà tái phát → tự mở lại; "ignored" giữ nguyên.
          status: sql`CASE WHEN ${clientErrors.status} = 'resolved' THEN 'open' ELSE ${clientErrors.status} END`,
        },
      });
  } catch (err) {
    console.warn("[server-error] không ghi được lỗi server:", (err as Error).message);
  }
}
