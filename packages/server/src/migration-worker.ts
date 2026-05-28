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
import { mssqlConnections } from "@erp-framework/db";
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
  action: MigrationAction;
  module: string;
  status: "queued" | "running" | "completed" | "failed";
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
  const jobId = randomUUID();
  const full: MigrationJobData = { ...data, jobId };

  const state: JobState = {
    jobId,
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

export function getMigrationJobStatus(jobId: string): JobState | null {
  return jobStates.get(jobId) ?? null;
}

async function handleMigrationJob(data: MigrationJobData): Promise<void> {
  const t0 = Date.now();
  const state = jobStates.get(data.jobId);
  if (!state) {
    console.warn(`[migration-worker] Job ${data.jobId} không có state — skip`);
    return;
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
      case "enrich":
        await runEnrich({
          module: data.module,
          apply: boolArg(data.args.apply, false),
          maxCostUsd: numArg(data.args.maxCostUsd, 5),
          skipEnriched: boolArg(data.args.skipEnriched, false),
          onlyProcs: arrayArg(data.args.onlyProcs),
          mssqlClient: mc(),
          companyId: data.companyId,
        });
        break;
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
        state.message = `Full import: ${r.succeededTables} table done, ${r.failedTables} failed, ${r.totalRows} rows this run`;
        break;
      }
    }

    state.status = "completed";
    state.completedAt = new Date().toISOString();
    state.durationMs = Date.now() - t0;
    publishWs(`migration:${data.userId}`, { kind: "completed", state });
  } catch (e) {
    state.status = "failed";
    state.completedAt = new Date().toISOString();
    state.durationMs = Date.now() - t0;
    state.error = (e as Error).message;
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
