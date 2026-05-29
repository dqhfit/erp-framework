/* ==========================================================
   migration-codegen-batch.ts — Phase R Tier 2 batch codegen.

   Loop tất cả proc tier B/D trong manifest, gọi codegenProc + apply
   tự động. Skip proc inactive / dirty (chờ migrate bảng). Publish
   progress per proc qua WS channel migration:<userId>.
   ========================================================== */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import YAML from "yaml";
import { and, eq } from "drizzle-orm";
import { entities, procedures } from "@erp-framework/db";
import { codegenProc, type CodegenProcResult } from "@erp-framework/migration-cli/enrich";
import type { MssqlClient } from "@erp-framework/mssql-client";
import type { DB } from "./db";
import { buildCombinedMigratedTableSet } from "./migration-migrated-set";

const MODULES_DIR = (): string => resolve(process.cwd(), "migration-plan", "modules");

export interface RunGenerateOpts {
  /** Skip nếu procedure name (tier B) đã có trong DB. Default true. */
  skipExisting?: boolean;
  /** Ghi đè file tier D nếu đã tồn tại. Default false. */
  overwriteFiles?: boolean;
  /** Bỏ qua check Q4 (dirty) — sinh code dù bảng chưa migrate. Default false. */
  includeDirty?: boolean;
  /** Chỉ chạy tier cụ thể. undefined = cả B + D. */
  onlyTier?: "B" | "D";
}

export interface RunGenerateProgress {
  procName: string;
  current: number;
  total: number;
  status: "applied" | "skipped" | "failed";
  reason?: string;
}

export interface RunGenerateResult {
  module: string;
  total: number;
  succeeded: number;
  skipped: number;
  failed: number;
  results: Array<{
    procName: string;
    tier: "B" | "D" | "C";
    status: "applied" | "skipped" | "failed";
    reason?: string;
    target?: string;
  }>;
}

interface ProcEntry {
  name: string;
  suggestedTier: "B" | "C" | "D";
  active?: boolean;
  reads?: string[];
  writes?: string[];
  targetProcName?: string;
  targetFile?: string;
}

interface ManifestShape {
  module?: string;
  procs?: ProcEntry[];
}

/** Loop tất cả proc trong manifest, sinh code + apply. Publish progress
 *  qua callback để worker forward ra WS. */
export async function runGenerateModule(args: {
  db: DB;
  mssqlClient: MssqlClient;
  module: string;
  companyId: string;
  userId: string;
  opts?: RunGenerateOpts;
  publishProgress?: (p: RunGenerateProgress) => void;
}): Promise<RunGenerateResult> {
  const opts: Required<
    Pick<RunGenerateOpts, "skipExisting" | "overwriteFiles" | "includeDirty">
  > & {
    onlyTier?: "B" | "D";
  } = {
    skipExisting: args.opts?.skipExisting ?? true,
    overwriteFiles: args.opts?.overwriteFiles ?? false,
    includeDirty: args.opts?.includeDirty ?? false,
    onlyTier: args.opts?.onlyTier,
  };

  // Đọc manifest module.
  const manifestPath = resolve(MODULES_DIR(), `${args.module}.yaml`);
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest "${args.module}" không tồn tại tại ${manifestPath}.`);
  }
  const m = YAML.parse(readFileSync(manifestPath, "utf8")) as ManifestShape;
  const allProcs = m.procs ?? [];
  const candidates = allProcs.filter((p) => {
    if (p.suggestedTier === "C") return false; // skip workflow tier
    if (p.active === false) return false;
    if (opts.onlyTier && p.suggestedTier !== opts.onlyTier) return false;
    return true;
  });

  // Combined: YAML + DB entities (bao gồm bảng từ Migrate nhanh).
  const migratedSet = await buildCombinedMigratedTableSet(args.db, args.companyId, MODULES_DIR());
  const results: RunGenerateResult["results"] = [];
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i++) {
    const proc = candidates[i]!;
    const current = i + 1;
    const total = candidates.length;

    // Pre-flight Q4: dirty check.
    if (!opts.includeDirty) {
      const touched = [...(proc.reads ?? []), ...(proc.writes ?? [])];
      const missing = touched.filter((t) => !migratedSet.has(t.toLowerCase()));
      if (missing.length > 0) {
        const reason = `waiting-tables: ${missing.join(", ")}`;
        results.push({
          procName: proc.name,
          tier: proc.suggestedTier,
          status: "skipped",
          reason,
        });
        skipped++;
        args.publishProgress?.({ procName: proc.name, current, total, status: "skipped", reason });
        continue;
      }
    }

    // Tier B: check existing.
    if (proc.suggestedTier === "B" && opts.skipExisting && proc.targetProcName) {
      const [existing] = await args.db
        .select({ id: procedures.id })
        .from(procedures)
        .where(
          and(eq(procedures.companyId, args.companyId), eq(procedures.name, proc.targetProcName)),
        )
        .limit(1);
      if (existing) {
        const reason = "already-applied";
        results.push({
          procName: proc.name,
          tier: proc.suggestedTier,
          status: "skipped",
          reason,
          target: proc.targetProcName,
        });
        skipped++;
        args.publishProgress?.({ procName: proc.name, current, total, status: "skipped", reason });
        continue;
      }
    }

    // Gọi AI codegen.
    let codegen: CodegenProcResult;
    try {
      codegen = await codegenProc({
        module: args.module,
        procName: proc.name,
        mssqlClient: args.mssqlClient,
        companyId: args.companyId,
      });
    } catch (e) {
      const reason = `codegen-error: ${(e as Error).message}`;
      results.push({
        procName: proc.name,
        tier: proc.suggestedTier,
        status: "failed",
        reason,
      });
      failed++;
      args.publishProgress?.({ procName: proc.name, current, total, status: "failed", reason });
      continue;
    }
    if (!codegen.output) {
      const reason = `ai-output-null: ${codegen.error ?? "unknown"}`;
      results.push({
        procName: proc.name,
        tier: proc.suggestedTier,
        status: "failed",
        reason,
      });
      failed++;
      args.publishProgress?.({ procName: proc.name, current, total, status: "failed", reason });
      continue;
    }

    // Apply.
    try {
      const out = codegen.output;
      if (out.tier === "B") {
        // Upsert procedures.
        const [existing] = await args.db
          .select({ id: procedures.id })
          .from(procedures)
          .where(and(eq(procedures.companyId, args.companyId), eq(procedures.name, out.name)))
          .limit(1);
        const values = {
          label: out.label,
          description: out.description,
          paramsSchema: out.paramsSchema as unknown[],
          code: out.code,
          updatedAt: new Date(),
        };
        if (existing) {
          await args.db.update(procedures).set(values).where(eq(procedures.id, existing.id));
        } else {
          await args.db.insert(procedures).values({
            companyId: args.companyId,
            name: out.name,
            createdBy: args.userId,
            ...values,
          });
        }
        results.push({
          procName: proc.name,
          tier: "B",
          status: "applied",
          target: out.name,
        });
        succeeded++;
        args.publishProgress?.({
          procName: proc.name,
          current,
          total,
          status: "applied",
        });
      } else {
        // Tier D: ghi file plugin.
        const fileName = out.fileName;
        if (fileName.includes("/") || fileName.includes("\\") || !fileName.endsWith(".ts")) {
          throw new Error(`fileName "${fileName}" không hợp lệ (phải basename *.ts).`);
        }
        const pluginDir = resolve(process.cwd(), "packages", "plugins", `module-${args.module}`);
        mkdirSync(pluginDir, { recursive: true });
        const target = resolve(pluginDir, fileName);
        if (!target.startsWith(pluginDir + sep)) {
          throw new Error("Path không hợp lệ (escape pluginDir).");
        }
        const exists = existsSync(target);
        if (exists && !opts.overwriteFiles) {
          const reason = "file-exists";
          results.push({
            procName: proc.name,
            tier: "D",
            status: "skipped",
            reason,
            target,
          });
          skipped++;
          args.publishProgress?.({
            procName: proc.name,
            current,
            total,
            status: "skipped",
            reason,
          });
          continue;
        }
        writeFileSync(target, out.code, "utf8");
        results.push({
          procName: proc.name,
          tier: "D",
          status: "applied",
          target,
        });
        succeeded++;
        args.publishProgress?.({
          procName: proc.name,
          current,
          total,
          status: "applied",
        });
      }
    } catch (e) {
      const reason = `apply-error: ${(e as Error).message}`;
      results.push({
        procName: proc.name,
        tier: proc.suggestedTier,
        status: "failed",
        reason,
      });
      failed++;
      args.publishProgress?.({ procName: proc.name, current, total, status: "failed", reason });
    }
  }

  // Silent reference để TS không complain entities import unused (sẽ dùng tương lai cho page codegen).
  void entities;

  return {
    module: args.module,
    total: candidates.length,
    succeeded,
    skipped,
    failed,
    results,
  };
}
