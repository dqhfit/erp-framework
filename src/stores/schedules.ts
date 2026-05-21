/* ==========================================================
   schedules store — Lịch chạy workflow tự động (cron).
   Persist localStorage. Scheduler runtime (core/scheduler.ts)
   đọc store này để biết workflow nào cần chạy.
   ========================================================== */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Schedule {
  id: string;
  workflowId: string;
  workflowName: string;
  /** Biểu thức cron 5 trường. */
  cronExpr: string;
  enabled: boolean;
  createdAt: number;
  /** Lần chạy gần nhất (timestamp ms). */
  lastRun?: number;
  /** Kết quả lần chạy gần nhất. */
  lastStatus?: "completed" | "paused" | "error";
  /** Số lần đã chạy. */
  runCount: number;
}

interface SchedulesState {
  schedules: Schedule[];
  addSchedule: (s: Omit<Schedule, "id" | "createdAt" | "runCount">) => string;
  updateSchedule: (id: string, patch: Partial<Schedule>) => void;
  deleteSchedule: (id: string) => void;
  toggleSchedule: (id: string) => void;
  /** Ghi nhận một lần chạy xong. */
  markRun: (id: string, status: Schedule["lastStatus"]) => void;
}

export const useSchedules = create<SchedulesState>()(
  persist(
    (set) => ({
      schedules: [],
      addSchedule: (s) => {
        const id = "sch_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
        set((st) => ({
          schedules: [
            ...st.schedules,
            { ...s, id, createdAt: Date.now(), runCount: 0 },
          ],
        }));
        return id;
      },
      updateSchedule: (id, patch) => set((st) => ({
        schedules: st.schedules.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      })),
      deleteSchedule: (id) => set((st) => ({
        schedules: st.schedules.filter((s) => s.id !== id),
      })),
      toggleSchedule: (id) => set((st) => ({
        schedules: st.schedules.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
      })),
      markRun: (id, status) => set((st) => ({
        schedules: st.schedules.map((s) =>
          s.id === id
            ? { ...s, lastRun: Date.now(), lastStatus: status, runCount: s.runCount + 1 }
            : s,
        ),
      })),
    }),
    { name: "erp-schedules" },
  ),
);
