/* ==========================================================
   activity.ts — Ghi nhật ký hành động vào bảng activity_log.
   Dùng ở server (workflow run, CRUD record…). Lỗi ghi log
   KHÔNG làm hỏng request chính — chỉ log ra console.
   ========================================================== */
import { activityLog } from "@erp-framework/db";
import type { DB } from "./db";

export interface ActivityInput {
  /** Công ty sở hữu bản ghi nhật ký (đa công ty — bắt buộc). */
  companyId: string;
  kind: string;
  objectType?: string;
  target?: string;
  detail: string;
  tokensInput?: number;
  tokensOutput?: number;
  model?: string;
  cost?: number;
  actorUserId?: string;
}

export async function logActivity(db: DB, e: ActivityInput): Promise<void> {
  try {
    await db.insert(activityLog).values({
      companyId: e.companyId,
      kind: e.kind,
      objectType: e.objectType ?? null,
      target: e.target ?? null,
      detail: e.detail,
      tokensInput: e.tokensInput ?? null,
      tokensOutput: e.tokensOutput ?? null,
      model: e.model ?? null,
      cost: e.cost ?? null,
      actorUserId: e.actorUserId ?? null,
    });
  } catch (err) {
    console.error("[activity] ghi log lỗi:", (err as Error).message);
  }
}
