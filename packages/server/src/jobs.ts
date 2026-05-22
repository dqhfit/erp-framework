/* ==========================================================
   jobs.ts — pg-boss: hàng đợi job + scheduler cron.
   - Queue "workflow-run": chạy một workflow (worker bền vững).
   - Queue "scheduler-tick": phát mỗi phút; quét bảng schedules,
     schedule nào tới hạn (cronMatches) thì enqueue workflow-run.
   pg-boss dùng pool RIÊNG (max 5) — xem UPGRADE-PLAN 3.2.1.
   ========================================================== */
import PgBoss from "pg-boss";
import { eq, sql, lt } from "drizzle-orm";
import { schedules, agentHeartbeats, entitySyncs, sessions } from "@erp-framework/db";
import { cronMatches } from "@erp-framework/core";
import { db } from "./db";
import { executeWorkflow } from "./run-workflow";
import { runHeartbeat } from "./run-heartbeat";
import { runEntitySync } from "./run-entity-sync";

const QUEUE_RUN = "workflow-run";
const QUEUE_TICK = "scheduler-tick";
const QUEUE_HEARTBEAT = "agent-heartbeat-run";
const QUEUE_ENTITY_SYNC = "entity-sync-run";
const QUEUE_SESSION_CLEANUP = "session-cleanup";

interface RunJobData {
  workflowId: string;
  scheduleId?: string;
}
interface HeartbeatJobData {
  heartbeatId: string;
}
interface EntitySyncJobData {
  syncId: string;
}

let boss: PgBoss | null = null;

export async function startJobs(): Promise<void> {
  const url = process.env.DATABASE_URL
    ?? "postgres://localhost:5432/erp_framework";
  boss = new PgBoss({ connectionString: url, max: 5 });
  await boss.start();

  await boss.createQueue(QUEUE_RUN);
  await boss.createQueue(QUEUE_TICK);
  await boss.createQueue(QUEUE_HEARTBEAT);
  await boss.createQueue(QUEUE_ENTITY_SYNC);
  await boss.createQueue(QUEUE_SESSION_CLEANUP);

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

  // Worker: chạy một nhịp heartbeat (agent tự thức dậy & hành động).
  await boss.work<HeartbeatJobData>(QUEUE_HEARTBEAT, async (jobs) => {
    for (const job of jobs) {
      try {
        await runHeartbeat(db, job.data.heartbeatId);
      } catch (e) {
        console.error("[heartbeat] lỗi:", (e as Error).message);
      }
    }
  });

  // Worker: chạy một lượt đồng bộ MCP → entity_records.
  await boss.work<EntitySyncJobData>(QUEUE_ENTITY_SYNC, async (jobs) => {
    for (const job of jobs) {
      try {
        await runEntitySync(db, job.data.syncId);
      } catch (e) {
        console.error("[entity-sync] lỗi:", (e as Error).message);
      }
    }
  });

  // Worker: dọn phiên đăng nhập đã hết hạn — tránh bảng sessions
  // phình vô hạn (phiên TTL 7 ngày nhưng không tự xoá khi hết hạn).
  await boss.work(QUEUE_SESSION_CLEANUP, async () => {
    const deleted = await db.delete(sessions)
      .where(lt(sessions.expiresAt, new Date()))
      .returning({ id: sessions.id });
    if (deleted.length) {
      console.log(`[session-cleanup] đã xoá ${deleted.length} phiên hết hạn`);
    }
  });

  // Worker: tick mỗi phút — quét schedules + heartbeat + entity sync.
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
    const beats = await db.select().from(agentHeartbeats)
      .where(eq(agentHeartbeats.enabled, true));
    for (const hb of beats) {
      if (cronMatches(hb.cronExpr, now)) {
        await b.send(QUEUE_HEARTBEAT, { heartbeatId: hb.id });
      }
    }
    const syncs = await db.select().from(entitySyncs)
      .where(eq(entitySyncs.enabled, true));
    for (const sy of syncs) {
      if (cronMatches(sy.cronExpr, now)) {
        await b.send(QUEUE_ENTITY_SYNC, { syncId: sy.id });
      }
    }
  });

  // Cron: phát một job tick mỗi phút (idempotent — gọi lại chỉ cập nhật).
  await boss.schedule(QUEUE_TICK, "* * * * *");
  // Cron: dọn phiên hết hạn mỗi ngày lúc 03:00.
  await boss.schedule(QUEUE_SESSION_CLEANUP, "0 3 * * *");
  console.log("pg-boss: scheduler đang chạy (tick mỗi phút)");
}

export async function stopJobs(): Promise<void> {
  if (boss) {
    await boss.stop();
    boss = null;
  }
}
