/* ==========================================================
   scheduler.ts — Runtime chạy lịch workflow trong trình duyệt.
   Mỗi 20s tick một lần, so từng schedule với cron hiện tại.
   Chỉ chạy khi app đang mở (không có backend daemon).
   Chống chạy trùng trong cùng 1 phút bằng "fired key".
   ========================================================== */
import { useSchedules, type Schedule } from "@/stores/schedules";
import { cronMatches } from "@/lib/cron";
import { logActivity } from "@/stores/activity";

/** Hàm chạy workflow thật — app cung cấp khi startScheduler. */
export type ScheduleRunner = (
  schedule: Schedule,
) => Promise<"completed" | "paused" | "error">;

const TICK_MS = 20_000;

let timer: ReturnType<typeof setInterval> | null = null;
let runner: ScheduleRunner | null = null;
/** Đã kích hoạt schedule nào ở phút nào — chống fire trùng. */
const firedKeys = new Set<string>();

/** Key duy nhất cho (schedule, phút hiện tại). */
function minuteKey(id: string, d: Date): string {
  return `${id}@${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
}

async function tick(): Promise<void> {
  if (!runner) return;
  const now = new Date();
  const schedules = useSchedules.getState().schedules;
  for (const s of schedules) {
    if (!s.enabled) continue;
    if (!cronMatches(s.cronExpr, now)) continue;
    const key = minuteKey(s.id, now);
    if (firedKeys.has(key)) continue;
    firedKeys.add(key);
    // Dọn bớt key cũ để Set không phình.
    if (firedKeys.size > 200) {
      const first = firedKeys.values().next().value;
      if (first) firedKeys.delete(first);
    }
    void fireSchedule(s);
  }
}

async function fireSchedule(s: Schedule): Promise<void> {
  if (!runner) return;
  try {
    const status = await runner(s);
    useSchedules.getState().markRun(s.id, status);
  } catch (e) {
    useSchedules.getState().markRun(s.id, "error");
    logActivity({
      kind: "error", objectType: "workflow", target: s.workflowName,
      detail: `Lịch "${s.cronExpr}" lỗi: ${(e as Error).message}`,
    });
  }
}

/** Khởi động scheduler. Idempotent — gọi nhiều lần chỉ cập nhật runner. */
export function startScheduler(run: ScheduleRunner): void {
  runner = run;
  if (timer) return;
  timer = setInterval(() => { void tick(); }, TICK_MS);
  // Tick ngay một lần để không phải chờ 20s đầu.
  void tick();
}

/** Dừng scheduler. */
export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  runner = null;
  firedKeys.clear();
}

/** Scheduler có đang chạy không. */
export function isSchedulerRunning(): boolean {
  return timer !== null;
}
