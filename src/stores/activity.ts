/* ==========================================================
   activity store — Nhật ký mọi hành động trong app + cost
   tracking. Persist localStorage. Dùng cho Activity dashboard.
   ========================================================== */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { estimateCost } from "@/lib/pricing";

export type ActivityKind =
  | "create" | "update" | "delete"
  | "run_workflow" | "run_agent" | "mcp_call"
  | "login" | "error";

export interface ActivityEntry {
  id: string;
  at: number;                  // timestamp ms
  kind: ActivityKind;
  /** Loại object: entity/page/workflow/agent/... */
  objectType?: string;
  /** Tên/id object liên quan */
  target?: string;
  /** Mô tả ngắn */
  detail: string;
  /** Token usage nếu là call LLM */
  tokens?: { input: number; output: number };
  /** Model dùng (để tính cost) */
  model?: string;
  /** Chi phí ước tính USD */
  cost?: number;
  /** Người thực hiện */
  actor?: string;
}

interface ActivityState {
  entries: ActivityEntry[];
  /** Ghi 1 entry. Tự tính cost nếu có tokens + model. */
  log: (e: Omit<ActivityEntry, "id" | "at" | "cost">) => void;
  clear: () => void;
  /** Tổng hợp cho dashboard */
  totalCost: () => number;
  totalTokens: () => { input: number; output: number };
}

const MAX_ENTRIES = 500; // tránh localStorage phình vô hạn

export const useActivity = create<ActivityState>()(
  persist(
    (set, get) => ({
      entries: [],
      log: (e) => set((s) => {
        const cost = e.tokens && e.model
          ? estimateCost(e.model, e.tokens.input, e.tokens.output)
          : undefined;
        const entry: ActivityEntry = {
          ...e,
          id: "act_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
          at: Date.now(),
          cost,
        };
        // Mới nhất lên đầu, cắt bớt
        return { entries: [entry, ...s.entries].slice(0, MAX_ENTRIES) };
      }),
      clear: () => set({ entries: [] }),
      totalCost: () => get().entries.reduce((sum, e) => sum + (e.cost ?? 0), 0),
      totalTokens: () => get().entries.reduce(
        (acc, e) => ({
          input: acc.input + (e.tokens?.input ?? 0),
          output: acc.output + (e.tokens?.output ?? 0),
        }),
        { input: 0, output: 0 },
      ),
    }),
    { name: "erp-activity" },
  ),
);

/** Helper ngoài React — ghi nhanh 1 activity */
export function logActivity(e: Omit<ActivityEntry, "id" | "at" | "cost">): void {
  useActivity.getState().log(e);
}
