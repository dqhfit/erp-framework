/* ==========================================================
   jobs.ts — pg-boss: hàng đợi job + scheduler cron.
   - Queue "workflow-run": chạy một workflow (worker bền vững).
   - Queue "scheduler-tick": phát mỗi phút; quét bảng schedules,
     schedule nào tới hạn (cronMatches) thì enqueue workflow-run.
   pg-boss dùng pool RIÊNG (max 5) — xem UPGRADE-PLAN 3.2.1.
   ========================================================== */

import { cronMatches } from "@erp-framework/core";
import {
  agentHeartbeats,
  backupConfig,
  backupRuns,
  entitySyncs,
  knowledgeSources,
  migrationSyncModules,
  schedules,
  sessions,
} from "@erp-framework/db";
import { eq, isNotNull, lt, sql } from "drizzle-orm";
import PgBoss from "pg-boss";
import { runBackup } from "./backup";
import { db } from "./db";
import {
  type FeedbackAiJobData,
  QUEUE_FEEDBACK_AI,
  registerEnqueueFeedbackAi,
  runFeedbackAi,
} from "./feedback-ai";
import { resumeStaleFullJobs } from "./migration-full-import";
import { enqueueMigrationJob, QUEUE_MIGRATION, registerMigrationWorker } from "./migration-worker";
import { runEntitySync } from "./run-entity-sync";
import { runHeartbeat } from "./run-heartbeat";
import { runKbIngest } from "./run-kb-ingest";
import { executeWorkflow, registerDelayResumeEnqueuer, resumeWorkflowRun } from "./run-workflow";
import {
  type GuardrailLessonJobData,
  QUEUE_GUARDRAIL_LESSON,
  registerEnqueueGuardrailLesson,
  synthesizeLesson,
} from "./workflow-guardrails";

const QUEUE_RUN = "workflow-run";
/** Queue resume node delay dài sau khi hết hạn (pg-boss startAfter). */
const QUEUE_WF_DELAY = "workflow-delay-resume";
const QUEUE_TICK = "scheduler-tick";
const QUEUE_HEARTBEAT = "agent-heartbeat-run";
const QUEUE_ENTITY_SYNC = "entity-sync-run";
const QUEUE_SESSION_CLEANUP = "session-cleanup";
/** Queue nạp tri thức Knowledge Base (trích + chunk + embed). */
export const QUEUE_KB_INGEST = "kb-ingest";
/** Queue chạy backup lên Google Drive (mỗi company một row). */
const QUEUE_BACKUP = "backup-run";

interface RunJobData {
  workflowId: string;
  scheduleId?: string;
  // Vars khởi tạo cho workflow run — chèn vào opts.context của
  // executeWorkflow. Dùng cho trigger iot_telemetry (truyền device +
  // payload xuống workflow), webhook (request body)…
  triggerContext?: Record<string, unknown>;
}
interface HeartbeatJobData {
  heartbeatId: string;
}
interface EntitySyncJobData {
  syncId: string;
}
interface KbIngestJobData {
  sourceId: string;
}
interface BackupJobData {
  runId: string;
  companyId: string;
}

let boss: PgBoss | null = null;

export async function startJobs(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "postgres://localhost:5432/erp_framework";
  boss = new PgBoss({ connectionString: url, max: 5 });
  await boss.start();

  await boss.createQueue(QUEUE_RUN);
  await boss.createQueue(QUEUE_WF_DELAY);
  await boss.createQueue(QUEUE_TICK);
  await boss.createQueue(QUEUE_HEARTBEAT);
  await boss.createQueue(QUEUE_ENTITY_SYNC);
  await boss.createQueue(QUEUE_SESSION_CLEANUP);
  await boss.createQueue(QUEUE_KB_INGEST);
  await boss.createQueue(QUEUE_BACKUP);
  await boss.createQueue(QUEUE_FEEDBACK_AI);
  await boss.createQueue(QUEUE_MIGRATION);
  await boss.createQueue(QUEUE_GUARDRAIL_LESSON);

  // Worker: chạy workflow khi có job.
  await boss.work<RunJobData>(QUEUE_RUN, async (jobs) => {
    for (const job of jobs) {
      const { workflowId, scheduleId, triggerContext } = job.data;
      const r = await executeWorkflow(db, workflowId, {
        scheduleId,
        context: triggerContext,
      });
      if (scheduleId) {
        await db
          .update(schedules)
          .set({
            lastRun: new Date(),
            lastStatus: r.status,
            runCount: sql`${schedules.runCount} + 1`,
          })
          .where(eq(schedules.id, scheduleId));
      }
    }
  });

  // Worker: resume workflow đang chờ node delay dài (tới giờ pg-boss phát).
  await boss.work<{ runId: string; nodeId: string; companyId: string }>(
    QUEUE_WF_DELAY,
    async (jobs) => {
      for (const job of jobs) {
        try {
          await resumeWorkflowRun(db, job.data.runId, {
            companyId: job.data.companyId,
            // System-scheduled (không actorRole) → bỏ qua RBAC như cron.
            decisions: { [`delay_done_${job.data.nodeId}`]: true },
          });
        } catch (e) {
          console.error("[workflow-delay] lỗi:", (e as Error).message);
        }
      }
    },
  );

  // DI: run-workflow lên lịch resume delay qua pg-boss (startAfter giây).
  registerDelayResumeEnqueuer(async (runId, nodeId, companyId, delayMs) => {
    if (!boss) throw new Error("Job runner chưa sẵn sàng");
    await boss.send(
      QUEUE_WF_DELAY,
      { runId, nodeId, companyId },
      { startAfter: Math.max(1, Math.ceil(delayMs / 1000)) },
    );
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

  // Worker: enrichment feedback (embedding + LLM summary/tags).
  await boss.work<FeedbackAiJobData>(QUEUE_FEEDBACK_AI, async (jobs) => {
    for (const job of jobs) {
      try {
        await runFeedbackAi(db, job.data.feedbackId);
      } catch (e) {
        console.error("[feedback-ai] lỗi:", (e as Error).message);
      }
    }
  });

  // DI: cho phép feedback-router gọi enqueue mà không phải import jobs.ts
  // (tránh circular: jobs.ts → feedback-ai → … nếu lại import jobs.ts).
  registerEnqueueFeedbackAi(async (id) => {
    if (!boss) throw new Error("Job runner chưa sẵn sàng");
    await boss.send(QUEUE_FEEDBACK_AI, { feedbackId: id });
  });

  // Worker: sinh "lesson" guardrail bằng LLM (fail-safe). Tách khỏi run để
  // không chặn workflow + sống qua restart (bền hơn fire-and-forget inline).
  await boss.work<GuardrailLessonJobData>(QUEUE_GUARDRAIL_LESSON, async (jobs) => {
    for (const job of jobs) {
      try {
        await synthesizeLesson(db, job.data.companyId, job.data.guardrailId, job.data.errorSample);
      } catch (e) {
        console.error("[guardrail-lesson] lỗi:", (e as Error).message);
      }
    }
  });
  // DI: workflow-guardrails enqueue mà không import jobs.ts (tránh circular).
  registerEnqueueGuardrailLesson(async (data) => {
    if (!boss) throw new Error("Job runner chưa sẵn sàng");
    await boss.send(QUEUE_GUARDRAIL_LESSON, data);
  });

  // Migration worker — DI tương tự để migration-router enqueue không cần
  // import jobs.ts (tránh circular import).
  await registerMigrationWorker({
    sendFn: async (queue, data) => {
      if (!boss) throw new Error("Job runner chưa sẵn sàng");
      return boss.send(queue, data);
    },
    workFn: async (queue, handler) => {
      if (!boss) throw new Error("Job runner chưa sẵn sàng");
      await boss.work(queue, handler);
    },
  });

  // Phase U: resume stale full-import jobs (heartbeat stale >3ph) — boot 1
  // lần + sweeper mỗi 5 phút. Sweeper bắt ca rolling deploy: lúc boot worker
  // container cũ còn sống (heartbeat tươi → bỏ qua), vài giây sau nó bị giết
  // → job 'running' mồ côi → sweep kế tiếp vớt. Lease (worker_token) trong
  // runFullImportJob đảm bảo enqueue thừa cũng không chạy song song.
  const sweepFullJobs = async () => {
    try {
      await resumeStaleFullJobs(async (jobId, userId) => {
        // Re-enqueue qua enqueueMigrationJob để hệ thống ws-state tracking đúng.
        // dummy companyId — runFullImportJob đọc lại từ DB.
        await enqueueMigrationJob({
          action: "full-import",
          module: jobId,
          args: {},
          userId,
          companyId: "",
        });
      });
    } catch (e) {
      console.warn("[jobs] Resume stale full jobs lỗi:", (e as Error).message);
    }
  };
  await sweepFullJobs();
  const fullJobSweeper = setInterval(sweepFullJobs, 5 * 60_000);
  fullJobSweeper.unref(); // không giữ process sống chỉ vì sweeper

  // Worker: nạp một nguồn tri thức vào Knowledge Base.
  await boss.work<KbIngestJobData>(QUEUE_KB_INGEST, async (jobs) => {
    for (const job of jobs) {
      try {
        await runKbIngest(db, job.data.sourceId);
      } catch (e) {
        console.error("[kb-ingest] lỗi:", (e as Error).message);
      }
    }
  });

  // Worker: chạy backup cho một company. Cập nhật backup_runs.
  await boss.work<BackupJobData>(QUEUE_BACKUP, async (jobs) => {
    for (const job of jobs) {
      const { runId, companyId } = job.data;
      try {
        const r = await runBackup(companyId);
        await db
          .update(backupRuns)
          .set({
            status: "done",
            dbDriveFileId: r.dbDriveFileId,
            dbBytes: r.dbBytes,
            uploadsSynced: r.uploadsSynced,
            uploadsSkipped: r.uploadsSkipped,
            uploadsBytes: r.uploadsBytes,
            finishedAt: new Date(),
          })
          .where(eq(backupRuns.id, runId));
      } catch (e) {
        const msg = (e as Error).message;
        console.error("[backup] lỗi:", msg);
        await db
          .update(backupRuns)
          .set({
            status: "error",
            error: msg,
            finishedAt: new Date(),
          })
          .where(eq(backupRuns.id, runId));
      }
    }
  });

  // Worker: dọn phiên đăng nhập đã hết hạn — tránh bảng sessions
  // phình vô hạn (phiên TTL 7 ngày nhưng không tự xoá khi hết hạn).
  await boss.work(QUEUE_SESSION_CLEANUP, async () => {
    const deleted = await db
      .delete(sessions)
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
    const rows = await db.select().from(schedules).where(eq(schedules.enabled, true));
    for (const s of rows) {
      if (cronMatches(s.cronExpr, now)) {
        await b.send(QUEUE_RUN, { workflowId: s.workflowId, scheduleId: s.id });
      }
    }
    const beats = await db.select().from(agentHeartbeats).where(eq(agentHeartbeats.enabled, true));
    for (const hb of beats) {
      if (cronMatches(hb.cronExpr, now)) {
        await b.send(QUEUE_HEARTBEAT, { heartbeatId: hb.id });
      }
    }
    const syncs = await db.select().from(entitySyncs).where(eq(entitySyncs.enabled, true));
    for (const sy of syncs) {
      if (cronMatches(sy.cronExpr, now)) {
        await b.send(QUEUE_ENTITY_SYNC, { syncId: sy.id });
      }
    }
    // Delta-sync MSSQL→PG — module enabled + cron tới hạn → enqueue.
    const syncMods = await db
      .select()
      .from(migrationSyncModules)
      .where(eq(migrationSyncModules.enabled, true));
    for (const sm of syncMods) {
      if (cronMatches(sm.cronExpr, now)) {
        // created_by phải là uuid user thật (làm created_by khi insert row
        // mới — chuỗi "system" vỡ cast ::uuid). Thiếu → skip + log, user
        // re-enable sync trong UI để backfill.
        if (!sm.createdBy) {
          console.warn(
            `[tick] delta-sync ${sm.module}: thieu created_by (bat sync lai trong UI de gan) — skip chu ky.`,
          );
          continue;
        }
        await enqueueMigrationJob({
          action: "delta-sync",
          module: sm.module,
          args: { connectionId: sm.connectionId },
          userId: sm.createdBy,
          companyId: sm.companyId,
        });
      }
    }

    // Knowledge Base — nguồn có reindex_cron tới hạn → nạp lại.
    const kbSources = await db
      .select()
      .from(knowledgeSources)
      .where(isNotNull(knowledgeSources.reindexCron));
    for (const ks of kbSources) {
      if (ks.reindexCron && cronMatches(ks.reindexCron, now)) {
        await b.send(QUEUE_KB_INGEST, { sourceId: ks.id });
      }
    }
    // Backup — company có schedule_cron tới hạn → tạo run + enqueue.
    const bcfgs = await db.select().from(backupConfig).where(isNotNull(backupConfig.scheduleCron));
    for (const bc of bcfgs) {
      if (bc.scheduleCron && cronMatches(bc.scheduleCron, now)) {
        const [run] = await db
          .insert(backupRuns)
          .values({
            companyId: bc.companyId,
            trigger: "cron",
          })
          .returning({ id: backupRuns.id });
        if (run) await b.send(QUEUE_BACKUP, { runId: run.id, companyId: bc.companyId });
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

/** Đưa một nguồn tri thức vào hàng đợi nạp (kb-ingest). Gọi từ
   knowledge-router / route upload sau khi tạo knowledge_sources. */
export async function enqueueKbIngest(sourceId: string): Promise<void> {
  if (!boss) {
    throw new Error("Job runner chưa sẵn sàng — thử lại sau giây lát.");
  }
  await boss.send(QUEUE_KB_INGEST, { sourceId });
}

/** Enqueue một workflow run thủ công với context vars. Dùng cho
   trigger iot_telemetry (truyền device + payload), webhook… */
export async function enqueueWorkflowRun(
  workflowId: string,
  triggerContext?: Record<string, unknown>,
): Promise<void> {
  if (!boss) {
    throw new Error("Job runner chưa sẵn sàng — thử lại sau giây lát.");
  }
  await boss.send(QUEUE_RUN, { workflowId, triggerContext });
}

/** Tạo backup_runs row + enqueue job. Trả runId để client theo dõi. */
export async function enqueueBackupRun(
  companyId: string,
  trigger: "manual" | "cron" = "manual",
): Promise<string> {
  if (!boss) {
    throw new Error("Job runner chưa sẵn sàng — thử lại sau giây lát.");
  }
  const [row] = await db
    .insert(backupRuns)
    .values({
      companyId,
      trigger,
      status: "running",
    })
    .returning({ id: backupRuns.id });
  if (!row) throw new Error("Không tạo được backup_runs row.");
  await boss.send(QUEUE_BACKUP, { runId: row.id, companyId });
  return row.id;
}
