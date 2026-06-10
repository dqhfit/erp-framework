/* ==========================================================
   entity-write-guard.ts — Chặn ghi vào entity đang ở chế độ
   mirror (đồng bộ 1 chiều MSSQL → PG chưa cutover).

   meta.sync.state = 'mirror' → throw PRECONDITION_FAILED.
   meta.sync.state = 'live' (hoặc không có) → cho phép ghi bình thường.

   Delta-sync worker ghi SQL trực tiếp → không qua guard (đúng ý).
   ========================================================== */

import { entities } from "@erp-framework/db";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { db } from "./db";

/** Throw PRECONDITION_FAILED nếu entity đang ở mirror state.
 *  Dùng trong records-router.ts mutations để chặn ghi user. */
export async function assertEntityNotMirror(companyId: string, entityId: string): Promise<void> {
  const [row] = await db
    .select({ meta: entities.meta })
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.companyId, companyId)))
    .limit(1);
  if (!row) return; // entity không tìm thấy → NOT_FOUND sẽ throw ở caller
  const state = (row.meta as { sync?: { state?: string } } | null)?.sync?.state;
  if (state === "mirror") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Entity này đang đồng bộ từ hệ thống cũ (mirror) — chưa thể ghi dữ liệu. " +
        "Chờ cutover hoặc liên hệ admin để chuyển sang chế độ live.",
    });
  }
}
