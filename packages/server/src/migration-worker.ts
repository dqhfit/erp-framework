/* ==========================================================
   migration-worker.ts — pg-boss handler chạy action migration
   (discover/enrich/capture-golden/data) ở background. Publish
   progress qua WS channel migration:<userId>.

   Kiến trúc: 1 queue "migration-run" duy nhất. Job data có
   field action để dispatch. Worker capture exception, kết quả
   trả về UI qua WS + log vào DB nếu cần.

   Note: MVP không stream log từng dòng (run* hiện tại dùng
   console.log global). Worker publish start + done/error.
   UI muốn log chi tiết → đọc qua aiLog endpoint sau khi done.
   ========================================================== */

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { migrationJobs, mssqlConnections } from "@erp-framework/db";
import { MssqlClient } from "@erp-framework/mssql-client";
import { runDiscover } from "@erp-framework/migration-cli/discover";
import { runEnrich } from "@erp-framework/migration-cli/enrich";
import { runCaptureGolden } from "@erp-framework/migration-cli/capture-golden";
import { runData } from "@erp-framework/migration-cli/data";
import { db } from "./db";
import { decryptSecret } from "./crypto";
import { publish as publishWs } from "./ws-hub";
import { runGenerateModule } from "./migration-codegen-batch";
import { runFullImportJob } from "./migration-full-import";

const QUEUE_MIGRATION = "migration-run";

type MigrationAction =
  | "discover"
  | "enrich"
  | "capture-golden"
  | "generate"
  | "data"
  | "audit"
  | "full-import";

interface MigrationJobData {
  jobId: string;
  action: MigrationAction;
  module: string;
  args: Record<string, unknown>;
  userId: string;
  companyId: string;
}

interface JobState {
  jobId: string;
  /** Chủ sở hữu — dùng để chặn đọc chéo tenant qua getMigrationJobStatus. */
  companyId: string;
  action: MigrationAction;
  module: string;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  message?: string;
  error?: string;
}

// In-memory state — pg-boss cũng lưu nhưng không api kindly,
// dùng Map để UI poll nhanh + ws-hub publish event.
const jobStates = new Map<string, JobState>();
const JOB_STATE_TTL_MS = 60 * 60 * 1000; // 1h sau khi done thì clean.

let bossSend: ((data: MigrationJobData) => Promise<string | null>) | null = null;

export interface MigrationWorkerHooks {
  /** boss.send → enqueue job. Truyền từ jobs.ts khi boot. */
  sendFn: (queue: string, data: MigrationJobData) => Promise<string | null>;
  /** boss.work → register handler. Truyền từ jobs.ts. */
  workFn: <T>(queue: string, handler: (jobs: Array<{ data: T }>) => Promise<void>) => Promise<void>;
}

export async function registerMigrationWorker(hooks: MigrationWorkerHooks): Promise<void> {
  bossSend = (data) => hooks.sendFn(QUEUE_MIGRATION, data);

  await hooks.workFn<MigrationJobData>(QUEUE_MIGRATION, async (jobs) => {
    for (const job of jobs) {
      await handleMigrationJob(job.data);
    }
  });
}

export async function enqueueMigrationJob(data: Omit<MigrationJobData, "jobId">): Promise<string> {
  if (!bossSend) {
    throw new Error("Migration worker chưa khởi tạo — server boot chưa xong?");
  }
  // full-import có bảng durable riêng (migration_full_jobs) + jobId nằm ở
  // field module. Action job khác → tạo row migration_jobs để state sống
  // sót restart + resume được. jobId = migration_jobs.id.
  let jobId: string;
  if (data.action === "full-import") {
    jobId = randomUUID();
  } else {
    const [row] = await db
      .insert(migrationJobs)
      .values({
        companyId: data.companyId,
        userId: data.userId,
        action: data.action,
        module: data.module,
        args: data.args,
        status: "queued",
      })
      .returning({ id: migrationJobs.id });
    if (!row) throw new Error("Insert migration job fail.");
    jobId = row.id;
  }
  const full: MigrationJobData = { ...data, jobId };

  const state: JobState = {
    jobId,
    companyId: data.companyId,
    action: data.action,
    module: data.module,
    status: "queued",
    startedAt: new Date().toISOString(),
  };
  jobStates.set(jobId, state);
  publishWs(`migration:${data.userId}`, { kind: "queued", state });

  await bossSend(full);
  return jobId;
}

/** Resume 1 action job đã lưu DB — re-enqueue cùng args (KHÔNG tạo row mới).
 *  Action idempotent (skipExisting/skipEnriched/merge) nên re-run = bỏ qua
 *  phần đã xong. Caller (router) phải kiểm tra quyền sở hữu trước. */
export async function resumeMigrationJob(jobId: string): Promise<void> {
  if (!bossSend) {
    throw new Error("Migration worker chưa khởi tạo — server boot chưa xong?");
  }
  const [row] = await db.select().from(migrationJobs).where(eq(migrationJobs.id, jobId));
  if (!row) throw new Error("Job không tồn tại.");
  await db
    .update(migrationJobs)
    .set({ status: "queued", error: null, lastHeartbeat: new Date(), updatedAt: new Date() })
    .where(eq(migrationJobs.id, jobId));
  const state: JobState = {
    jobId,
    companyId: row.companyId,
    action: row.action as MigrationAction,
    module: row.module,
    status: "queued",
    startedAt: new Date().toISOString(),
  };
  jobStates.set(jobId, state);
  const userId = row.userId ?? "";
  publishWs(`migration:${userId}`, { kind: "queued", state });
  const baseArgs = (row.args ?? {}) as Record<string, unknown>;
  // Enrich resume: bật skipEnriched để bỏ qua những item đã xong, tiếp tục từ đây.
  const resumeArgs = row.action === "enrich" ? { ...baseArgs, skipEnriched: true } : baseArgs;
  await bossSend({
    jobId,
    action: row.action as MigrationAction,
    module: row.module,
    args: resumeArgs,
    userId,
    companyId: row.companyId,
  });
}

/** Trạng thái job: ưu tiên in-memory (realtime), fallback DB (sau restart
 *  hoặc job cũ). full-import không có row migration_jobs → chỉ in-memory. */
export async function getMigrationJobStatus(
  jobId: string,
  companyId: string,
): Promise<JobState | null> {
  // companyId BẮT BUỘC: chặn đọc chéo tenant (trước đây chỉ filter theo jobId
  // → biết UUID là đọc được status/message/error của company khác).
  const mem = jobStates.get(jobId);
  if (mem) return mem.companyId === companyId ? mem : null;
  const [row] = await db
    .select()
    .from(migrationJobs)
    .where(and(eq(migrationJobs.id, jobId), eq(migrationJobs.companyId, companyId)));
  if (!row) return null;
  return {
    jobId: row.id,
    companyId: row.companyId,
    action: row.action as MigrationAction,
    module: row.module,
    status: row.status as JobState["status"],
    startedAt: (row.startedAt ?? row.createdAt).toISOString(),
    completedAt: row.completedAt?.toISOString(),
    durationMs: row.durationMs ?? undefined,
    message: row.message ?? undefined,
    error: row.error ?? undefined,
  };
}

async function handleMigrationJob(data: MigrationJobData): Promise<void> {
  const t0 = Date.now();
  const isFullImport = data.action === "full-import";
  // In-memory state có thể mất sau restart (pg-boss giao lại job) — dựng lại
  // từ data thay vì skip như trước (bug: job re-deliver bị bỏ im lặng).
  let state = jobStates.get(data.jobId);
  if (!state) {
    state = {
      jobId: data.jobId,
      companyId: data.companyId,
      action: data.action,
      module: data.module,
      status: "queued",
      startedAt: new Date().toISOString(),
    };
    jobStates.set(data.jobId, state);
  }

  // Action job durable: đọc row DB để (a) bỏ nếu đã cancel, (b) ++attempts,
  // (c) đánh dấu running. full-import có bảng riêng nên skip phần này.
  // baseTokens*: token đã tiêu các lần trước → enrich dùng làm baseline cho
  // --max-cost (trần thật, không reset mỗi resume).
  let baseTokensIn = 0;
  let baseTokensOut = 0;
  if (!isFullImport) {
    const [row] = await db
      .select({
        status: migrationJobs.status,
        attempts: migrationJobs.attempts,
        tokensIn: migrationJobs.tokensIn,
        tokensOut: migrationJobs.tokensOut,
      })
      .from(migrationJobs)
      .where(eq(migrationJobs.id, data.jobId));
    if (!row) {
      console.warn(`[migration-worker] Job ${data.jobId} không có DB row — skip`);
      return;
    }
    baseTokensIn = row.tokensIn ?? 0;
    baseTokensOut = row.tokensOut ?? 0;
    if (row.status === "canceled") {
      state.status = "canceled";
      console.warn(`[migration-worker] Job ${data.jobId} đã canceled — skip`);
      return;
    }
    await db
      .update(migrationJobs)
      .set({
        status: "running",
        attempts: (row.attempts ?? 0) + 1,
        startedAt: new Date(),
        error: null,
        lastHeartbeat: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(migrationJobs.id, data.jobId));
  }

  state.status = "running";
  publishWs(`migration:${data.userId}`, { kind: "started", state });

  let mssqlClient: MssqlClient | null = null;
  try {
    // full-import KHÔNG cần MSSQL client ở scope worker — runFullImportJob
    // tự mở connection theo job.connectionId trong DB (per-job, per-resume).
    if (data.action !== "full-import") {
      // Resolve MSSQL connection: arg connectionId > isDefault của company.
      const connectionId =
        typeof data.args.connectionId === "string" ? data.args.connectionId : undefined;
      mssqlClient = await loadMssqlClient(data.companyId, connectionId);
    }
    // Helper non-null assert — các case dưới đây (trừ full-import) luôn có client.
    const mc = () => {
      if (!mssqlClient) throw new Error("MSSQL client chưa khởi tạo cho action này.");
      return mssqlClient;
    };

    switch (data.action) {
      case "discover":
        await runDiscover({
          name: data.module,
          seedTables: arrayArg(data.args.seedTables),
          excludeTables: arrayArg(data.args.excludeTables),
          maxTables: numArg(data.args.maxTables, 30),
          mssqlClient: mc(),
        });
        break;
      case "enrich": {
        const enrichResult = await runEnrich({
          module: data.module,
          apply: boolArg(data.args.apply, false),
          maxCostUsd: numArg(data.args.maxCostUsd, 5),
          skipEnriched: boolArg(data.args.skipEnriched, false),
          baseTokensIn,
          baseTokensOut,
          onlyProcs: arrayArg(data.args.onlyProcs),
          mssqlClient: mc(),
          companyId: data.companyId,
          onProgress: ({ phase, name, index, total }) => {
            const label = phase === "table" ? "Table" : "Proc";
            const msg = `${label} ${index}/${total}: ${name}`;
            state!.message = msg;
            // Fire-and-forget: cập nhật message + heartbeat để UI poll thấy.
            db.update(migrationJobs)
              .set({ message: msg, lastHeartbeat: new Date(), updatedAt: new Date() })
              .where(eq(migrationJobs.id, data.jobId))
              .catch(() => undefined);
            publishWs(`migration:${data.userId}`, {
              kind: "enrich-progress",
              jobId: data.jobId,
              phase,
              name,
              index,
              total,
              message: msg,
            });
          },
        });
        // Persist token tích lũy → baseline cho lần resume tiếp (trần cost thật).
        await db
          .update(migrationJobs)
          .set({
            tokensIn: enrichResult.tokensIn,
            tokensOut: enrichResult.tokensOut,
            updatedAt: new Date(),
          })
          .where(eq(migrationJobs.id, data.jobId));
        break;
      }
      case "capture-golden":
        await runCaptureGolden({
          module: data.module,
          samples: numArg(data.args.samples, 10),
          mssqlClient: mc(),
        });
        break;
      case "data":
        await runData({
          module: data.module,
          tables: arrayArg(data.args.tables),
          table: typeof data.args.table === "string" ? data.args.table : undefined,
          limit: numArg(data.args.limit, 10_000),
          mssqlClient: mc(),
        });
        break;
      case "generate": {
        const r = await runGenerateModule({
          db,
          mssqlClient: mc(),
          module: data.module,
          companyId: data.companyId,
          userId: data.userId,
          opts: {
            skipExisting: boolArg(data.args.skipExisting, true),
            overwriteFiles: boolArg(data.args.overwriteFiles, false),
            includeDirty: boolArg(data.args.includeDirty, false),
            onlyTier: strTierArg(data.args.onlyTier),
          },
          publishProgress: (p) =>
            publishWs(`migration:${data.userId}`, { kind: "progress", jobId: data.jobId, ...p }),
        });
        state.message = `Codegen: ${r.succeeded} apply / ${r.skipped} skip / ${r.failed} fail (tổng ${r.total})`;
        break;
      }
      case "audit":
        throw new Error(`Action "audit" chưa triển khai (Tier 4).`);
      case "full-import": {
        // Full import: data.module = jobId (re-use field cho tiện);
        // không cần MSSQL client ở scope worker — runFullImportJob tự
        // mở connection theo job.connectionId trong DB.
        const r = await runFullImportJob({ jobId: data.module, userId: data.userId });
        state.message = `Full import: ${r.succeededTables} table done, ${r.failedTables} failed, ${r.skippedTables} skipped, ${r.totalRows} rows this run`;
        break;
      }
    }

    state.status = "completed";
    state.completedAt = new Date().toISOString();
    state.durationMs = Date.now() - t0;
    if (!isFullImport) {
      await db
        .update(migrationJobs)
        .set({
          status: "completed",
          message: state.message ?? null,
          completedAt: new Date(),
          durationMs: state.durationMs,
          lastHeartbeat: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(migrationJobs.id, data.jobId));
    }
    publishWs(`migration:${data.userId}`, { kind: "completed", state });
  } catch (e) {
    state.status = "failed";
    state.completedAt = new Date().toISOString();
    state.durationMs = Date.now() - t0;
    state.error = (e as Error).message;
    if (!isFullImport) {
      // Ghi lỗi vào DB để UI hiện + cho phép resume (re-enqueue cùng args).
      await db
        .update(migrationJobs)
        .set({
          status: "failed",
          error: state.error,
          completedAt: new Date(),
          durationMs: state.durationMs,
          lastHeartbeat: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(migrationJobs.id, data.jobId))
        .catch(() => undefined);
    }
    publishWs(`migration:${data.userId}`, { kind: "failed", state });
    console.error(`[migration-worker] Job ${data.jobId} failed:`, e);
  } finally {
    if (mssqlClient) {
      await mssqlClient.close().catch(() => undefined);
    }
    // Cleanup state sau TTL.
    setTimeout(() => jobStates.delete(data.jobId), JOB_STATE_TTL_MS);
  }
}

/** Tạo MssqlClient từ connection record của company (default nếu không đặt id). */
async function loadMssqlClient(companyId: string, connectionId?: string): Promise<MssqlClient> {
  const where = connectionId
    ? and(eq(mssqlConnections.id, connectionId), eq(mssqlConnections.companyId, companyId))
    : and(eq(mssqlConnections.companyId, companyId), eq(mssqlConnections.isDefault, true));
  const [row] = await db.select().from(mssqlConnections).where(where).limit(1);
  if (!row) {
    throw new Error(
      connectionId
        ? `Không tìm thấy connection ${connectionId} cho company ${companyId}.`
        : `Company ${companyId} chưa có connection MSSQL default. ` +
            `Vào Settings → Migration MSSQL → thêm connection và đặt làm mặc định.`,
    );
  }
  const client = MssqlClient.fromConfig({
    host: row.host,
    port: row.port,
    database: row.database,
    username: row.username,
    password: decryptSecret(row.passwordEnc),
    encrypt: row.encrypt,
    trustServerCert: row.trustServerCert,
    allowWrite: row.allowWrite,
    requestTimeoutMs: 60_000,
  });
  await client.connect();
  return client;
}

function arrayArg(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string" && v)
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}
function numArg(v: unknown, def: number): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : def;
  }
  return def;
}
function strTierArg(v: unknown): "B" | "D" | undefined {
  if (v === "B" || v === "D") return v;
  return undefined;
}
function boolArg(v: unknown, def: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === 1 || v === "1") return true;
  if (v === "false" || v === 0 || v === "0") return false;
  return def;
}

export { QUEUE_MIGRATION };
