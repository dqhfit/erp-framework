/* ==========================================================
   jobs.ts — pg-boss: hàng đợi job + scheduler cron.
   - Queue "workflow-run": chạy một workflow (worker bền vững).
   - Queue "scheduler-tick": phát mỗi phút; quét bảng schedules,
     schedule nào tới hạn (cronMatches) thì enqueue workflow-run.
   pg-boss dùng pool RIÊNG (max 5) — xem UPGRADE-PLAN 3.2.1.
   ========================================================== */
import PgBoss from "pg-boss";
import { eq, sql } from "drizzle-orm";
import { schedules } from "@erp-framework/db";
import { cronMatches } from "@erp-framework/core";
import { db } from "./db";
import { executeWorkflow } from "./run-workflow";

const QUEUE_RUN = "workflow-run";
const QUEUE_TICK = "scheduler-tick";

interface RunJobData {
  workflowId: string;
  scheduleId?: string;
}

let boss: PgBoss | null = null;

export async function startJobs(): Promise<void> {
  const url = process.env.DATABASE_URL
    ?? "postgres://localhost:5432/erp_framework";
  boss = new PgBoss({ connectionString: url, max: 5 });
  await boss.start();

  await boss.createQueue(QUEUE_RUN);
  await boss.createQueue(QUEUE_TICK);

  // Worker: chạy workflow khi có job.
  await boss.work<RunJobData>(QUEUE_RUN, async (jobs) => {
    for (const job of jobs) {
      const { workflowId, scheduleId } = job.data;
      const r = await executeWorkflow(db, workflowId, { scheduleId });
      if (scheduleId) {
        await db.update(schedules).set({
          lastRun: new Date(),
          lastStatus: r.status,
          runCount: sql`${schedules.runCount} + 1`,
        }).where(eq(schedules.id, scheduleId));
      }
    }
  });

  // Worker: tick mỗi phút — quét schedules tới hạn rồi enqueue.
  await boss.work(QUEUE_TICK, async () => {
    const b = boss;
    if (!b) return;
    const now = new Date();
    const rows = await db.select().from(schedules)
      .where(eq(schedules.enabled, true));
    for (const s of rows) {
      if (cronMatches(s.cronExpr, now)) {
        await b.send(QUEUE_RUN, { workflowId: s.workflowId, scheduleId: s.id });
      }
    }
  });

  // Cron: phát một job tick mỗi phút (idempotent — gọi lại chỉ cập nhật).
  await boss.schedule(QUEUE_TICK, "* * * * *");
  console.log("pg-boss: scheduler đang chạy (tick mỗi phút)");
}

export async function stopJobs(): Promise<void> {
  if (boss) {
    await boss.stop();
    boss = null;
  }
}
