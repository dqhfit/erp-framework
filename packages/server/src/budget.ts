/* ==========================================================
   budget.ts — Hạn mức chi phí tháng + chặn cứng (hard-stop).
   ĐA CÔNG TY: hạn mức + chi phí tính RIÊNG cho từng công ty.
   Hạn mức lưu trong bảng config (mcp_configs, name="budget" theo
   từng company_id). Chi phí tháng tính từ activity_log.cost của
   chính công ty đó. Vượt hạn mức → ném lỗi, chặn workflow/agent.
   ========================================================== */
import { sql, and, gte, eq } from "drizzle-orm";
import { mcpConfigs, activityLog } from "@erp-framework/db";
import type { DB } from "./db";

const BUDGET_KEY = "budget";

export interface BudgetConfig {
  /** Hạn mức USD/tháng. 0 = không giới hạn. */
  monthlyUsd: number;
}

export async function getBudget(db: DB, companyId: string): Promise<BudgetConfig> {
  const [row] = await db.select().from(mcpConfigs)
    .where(and(eq(mcpConfigs.name, BUDGET_KEY),
      eq(mcpConfigs.companyId, companyId)));
  const c = (row?.config ?? {}) as Partial<BudgetConfig>;
  return { monthlyUsd: typeof c.monthlyUsd === "number" ? c.monthlyUsd : 0 };
}

export async function setBudget(
  db: DB,
  companyId: string,
  monthlyUsd: number,
): Promise<void> {
  const [ex] = await db.select({ id: mcpConfigs.id }).from(mcpConfigs)
    .where(and(eq(mcpConfigs.name, BUDGET_KEY),
      eq(mcpConfigs.companyId, companyId)));
  if (ex) {
    await db.update(mcpConfigs).set({ config: { monthlyUsd } })
      .where(eq(mcpConfigs.id, ex.id));
  } else {
    await db.insert(mcpConfigs)
      .values({ companyId, name: BUDGET_KEY, config: { monthlyUsd } });
  }
}

function monthStart(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Tổng chi phí (USD) đã ghi trong tháng hiện tại của một công ty. */
export async function monthUsageUsd(db: DB, companyId: string): Promise<number> {
  const [r] = await db
    .select({ total: sql<number>`coalesce(sum(${activityLog.cost}), 0)::float` })
    .from(activityLog)
    .where(and(gte(activityLog.at, monthStart()),
      eq(activityLog.companyId, companyId)));
  return r?.total ?? 0;
}

/** Ném lỗi nếu chi phí tháng của công ty đã chạm/vượt hạn mức. Gọi
   TRƯỚC khi chạy workflow / agent. monthlyUsd = 0 → bỏ qua.

   NGỮ NGHĨA — đây là HẠN MỨC MỀM, có chủ đích:
   - Chi phí của một lần chạy chỉ biết được SAU khi chạy xong (token
     do LLM trả về), nên không thể "đặt chỗ" ngân sách trước.
   - Vì vậy các lần chạy song song đều có thể qua cửa cùng lúc; tổng
     chi phí có thể vượt hạn mức tối đa thêm ~ (số lần chạy đang bay)
     × (chi phí mỗi lần). Lần chạy KẾ TIẾP sau khi vượt sẽ bị chặn.
   - Đây là đánh đổi chấp nhận được: chặn cứng tuyệt đối cần một bảng
     "đặt chỗ ngân sách" (reservation) + ước lượng chi phí trước —
     phức tạp và vẫn phải ước lượng sai số. Nếu cần hard-limit tuyệt
     đối, đó là một hạng mục kiến trúc riêng (xem PROJECT-ANALYSIS). */
export async function assertWithinBudget(
  db: DB,
  companyId: string,
): Promise<void> {
  const { monthlyUsd } = await getBudget(db, companyId);
  if (monthlyUsd <= 0) return;
  const used = await monthUsageUsd(db, companyId);
  if (used >= monthlyUsd) {
    throw new Error(
      `Vượt ngân sách tháng ($${used.toFixed(2)} / $${monthlyUsd}). `
      + "Tăng hạn mức ở trang Nhật ký & Chi phí.",
    );
  }
}
