/* ==========================================================
   enrich.ts — Tier 1: AI đọc manifest auto-generated từ discover,
   suggest tên entity/field/proc tiếng Việt chuẩn + tier override
   + description nghiệp vụ.

   Output: <module>.enriched.yaml bên cạnh <module>.yaml. Human
   diff trước khi --apply ghi đè.
   ========================================================== */

import { MssqlClient } from "@erp-framework/mssql-client";
import {
  readManifest,
  writeManifest,
  manifestPath,
  type ManifestTable,
  type ManifestProc,
} from "../manifest.js";
import { callAi, loadStyleGuide, loadPrompt, estimateCostUsd } from "./llm-client.js";

export interface EnrichProgressInfo {
  phase: "table" | "proc";
  name: string;
  /** Số thứ tự trong batch hiện tại (1-based). */
  index: number;
  total: number;
}

export interface EnrichOptions {
  module: string;
  apply: boolean;
  /** Bỏ qua table/proc đã có label tiếng Việt (re-run). */
  skipEnriched?: boolean;
  /** Cắp chi phí USD. Mặc định 5. */
  maxCostUsd?: number;
  /** Inject client từ worker. Nếu thiếu, dùng fromEnv() (CLI standalone). */
  mssqlClient?: MssqlClient;
  /** Company target cho LLM call. Worker pass từ job; CLI fallback env. */
  companyId?: string;
  /** Chỉ enrich proc theo danh sách (full name "schema.proc"). Khi set:
   *  - bỏ qua phần enrich table
   *  - KHÔNG ghi enriched.yaml (dry-run thuần, chỉ log vào ai-log)
   *  Dùng để debug 1 proc cụ thể trước khi run cả module. */
  onlyProcs?: string[];
  /** Callback per-item để worker/UI theo dõi tiến trình. */
  onProgress?: (info: EnrichProgressInfo) => void;
}

interface EnrichedTableOutput {
  suggestedEntityName: string;
  /** "entity" mặc định; "enum" cho lookup table nhỏ — KHÔNG sinh entity. */
  suggestedKind?: "entity" | "enum";
  label: string;
  description: string;
  /** Có khi suggestedKind=enum — list label tiếng Việt có dấu. */
  enumOptions?: string[];
  columns: Array<{
    originalName: string;
    field: string;
    label: string;
    description?: string;
    entityType: string;
    required?: boolean;
    options?: string[];
    relationEntity?: string;
  }>;
}

interface EnrichedProcOutput {
  originalName: string;
  targetProcName?: string;
  targetFile?: string;
  label: string;
  description: string;
  tier: "B" | "C" | "D";
  tierReason?: string;
  schedule?: string;
}

export async function runEnrich(opts: EnrichOptions): Promise<void> {
  const m = readManifest(opts.module);
  const onlyProcs = opts.onlyProcs && opts.onlyProcs.length > 0 ? opts.onlyProcs : null;
  const isSingleProcMode = onlyProcs != null;
  console.log(
    isSingleProcMode
      ? `▸ Enrich proc riêng (dry-run) module "${opts.module}" — ${onlyProcs!.length} proc`
      : `▸ Enrich module "${opts.module}" — ${m.tables.length} table, ${m.procs.length} proc`,
  );
  const maxCost = opts.maxCostUsd ?? 5;

  const styleGuide = loadStyleGuide();
  const promptTable = loadPrompt("enrich-table").replace("{STYLE_GUIDE}", styleGuide);
  const promptProc = loadPrompt("enrich-proc").replace("{STYLE_GUIDE}", styleGuide);

  // Connect MSSQL để lấy sample 5 row / table.
  const ownedClient = !opts.mssqlClient;
  const mssql = opts.mssqlClient ?? MssqlClient.fromEnv();
  if (ownedClient) await mssql.connect();

  let totalIn = 0;
  let totalOut = 0;
  let costStopped = false;
  let tablesDone = 0;
  let procsDone = 0;

  try {
    // --- Enrich table --- (bỏ qua khi single-proc mode)
    if (!isSingleProcMode) {
      for (const t of m.tables) {
        if (opts.skipEnriched && t.enrichedAt) continue;
        let samples: unknown[] = [];
        try {
          samples = await mssql.bulkRead(t.name, { limit: 5 });
        } catch (e) {
          console.warn(`  ! Không đọc được sample từ ${t.name}: ${(e as Error).message}`);
        }

        const userPayload = JSON.stringify({
          tableName: t.name,
          columns: t.columns.map((c) => ({
            name: c.name,
            dataType: c.type,
            isNullable: c.isNullable,
            isPk: t.primaryKey.includes(c.name),
            isFk: !!(t.inferredRelations ?? []).find((r) => r.column === c.name),
            refTable: (t.inferredRelations ?? []).find((r) => r.column === c.name)?.refTable,
            refColumn: (t.inferredRelations ?? []).find((r) => r.column === c.name)?.refColumn,
          })),
          samples,
        });

        const r = await callAi<EnrichedTableOutput>(
          {
            module: opts.module,
            phase: `enrich-table-${t.name.replace(/\W/g, "_")}`,
            companyId: opts.companyId,
          },
          {
            system: promptTable,
            user: userPayload,
            maxTokens: 3000,
            temperature: 0.2,
          },
        );
        totalIn += r.tokensInApprox;
        totalOut += r.tokensOutApprox;

        if (r.output) {
          applyTableEnrichment(t, r.output);
          console.log(`  ✓ table ${t.name} → ${t.suggestedEntityName} (${t.columns.length} field)`);
        } else {
          console.log(`  ! Skip table ${t.name} (LLM fail — giữ auto-generated)`);
        }
        tablesDone++;
        opts.onProgress?.({
          phase: "table",
          name: t.name,
          index: tablesDone,
          total: m.tables.length,
        });

        const cost = estimateCostUsd(totalIn, totalOut);
        if (cost > maxCost) {
          console.warn(
            `  ! Vượt --max-cost-usd=${maxCost} (~${cost.toFixed(2)} USD). Dừng sớm — progress đã lưu, resume bằng skipEnriched.`,
          );
          costStopped = true;
          break;
        }
      }
    } // end if !isSingleProcMode

    // --- Enrich proc ---
    const enrichedTableMap = Object.fromEntries(
      m.tables.map((t) => [t.name, t.suggestedEntityName]),
    );

    const procsToEnrich = isSingleProcMode
      ? m.procs.filter((p) => onlyProcs!.includes(p.name))
      : m.procs;
    if (isSingleProcMode && procsToEnrich.length === 0) {
      console.warn(`! Không tìm thấy proc nào khớp onlyProcs=${onlyProcs!.join(",")}`);
    }

    if (!costStopped) {
      for (const p of procsToEnrich) {
        if (opts.skipEnriched && p.enrichedAt) continue;

        let body = "";
        try {
          const [sch, name] = p.name.split(".");
          if (sch && name) {
            const proc = await mssql.getProc(sch, name);
            body = proc?.body ?? "";
          }
        } catch (e) {
          console.warn(`  ! Không đọc body ${p.name}: ${(e as Error).message}`);
        }
        // Truncate body để tránh vượt context.
        if (body.length > 6000) body = body.slice(0, 6000) + "\n-- ... (truncated)";

        const userPayload = JSON.stringify({
          procName: p.name,
          body,
          parseAnalysis: {
            readsTables: p.reads,
            writesTables: p.writes,
            flags: p.flags,
            suggestedTier: p.suggestedTier,
          },
          tablesEnriched: enrichedTableMap,
        });

        const r = await callAi<EnrichedProcOutput>(
          {
            module: opts.module,
            phase: `enrich-proc-${p.name.replace(/\W/g, "_")}`,
            companyId: opts.companyId,
          },
          {
            system: promptProc,
            user: userPayload,
            maxTokens: 1000,
            temperature: 0.2,
          },
        );
        totalIn += r.tokensInApprox;
        totalOut += r.tokensOutApprox;

        if (r.output) {
          applyProcEnrichment(p, r.output, opts.module);
          console.log(
            `  ✓ proc ${p.name} → ${p.targetProcName ?? p.targetFile} [tier ${p.suggestedTier}]`,
          );
        } else {
          console.log(`  ! Skip proc ${p.name} (LLM fail)`);
        }
        procsDone++;
        opts.onProgress?.({
          phase: "proc",
          name: p.name,
          index: procsDone,
          total: procsToEnrich.length,
        });

        const cost = estimateCostUsd(totalIn, totalOut);
        if (cost > maxCost) {
          console.warn(
            `  ! Vượt --max-cost-usd=${maxCost} (~${cost.toFixed(2)} USD). Dừng sớm — progress đã lưu, resume bằng skipEnriched.`,
          );
          costStopped = true;
          break;
        }
      }
    }
  } finally {
    if (ownedClient) await mssql.close();
  }

  // Ghi enriched manifest. Single-proc dry-run KHÔNG ghi (tránh đè
  // enriched.yaml hiện tại với chỉ 1 proc enriched). User xem output
  // qua ai-log/<module>/enrich-proc-<name>-*.json.
  // costStopped=true vẫn ghi để giữ partial progress — resume dùng skipEnriched.
  let outPath = "(không ghi — dry-run 1 proc, xem ai-log)";
  if (!isSingleProcMode) {
    outPath = opts.apply
      ? manifestPath(opts.module)
      : manifestPath(opts.module).replace(/\.yaml$/, ".enriched.yaml");
    writeManifest(m, outPath);
  }

  const cost = estimateCostUsd(totalIn, totalOut);
  if (costStopped) {
    console.log(`\n⚠ Enrich dừng giữa chừng (vượt cost): ${outPath}`);
    console.log(`  Token ~ in:${totalIn} out:${totalOut}  Cost ~ $${cost.toFixed(3)}`);
    console.log(
      `  Resume: chạy lại với --skip-enriched (hoặc bấm Resume trong UI) để tiếp tục từ đây.`,
    );
  } else {
    console.log(`\n✓ Enrich xong: ${outPath}`);
    console.log(`  Token ~ in:${totalIn} out:${totalOut}  Cost ~ $${cost.toFixed(3)}`);
    if (!opts.apply && !isSingleProcMode) {
      console.log(`\n▸ Diff <module>.yaml vs <module>.enriched.yaml trước khi --apply.`);
      console.log(`  Hoặc chạy lại: pnpm migrate enrich --module ${opts.module} --apply`);
    }
  }
}

/** Tier 4: audit module sau khi port — AI đọc snapshot (manifest +
 *  procedures code + plugins code + golden stats) → sinh Markdown
 *  checklist các điểm cần hoàn thiện theo severity Critical/High/Medium/Low.
 *
 *  KHÔNG trả JSON — Markdown thuần do AI viết. Caller (UI/CLI) hiển thị
 *  raw + optionally render. */
export interface AuditModuleInput {
  module: string;
  manifest: unknown;
  procedures: Array<{
    name: string;
    label?: string;
    description?: string | null;
    paramsSchema?: unknown;
    code: string;
  }>;
  plugins: Array<{ fileName: string; code: string }>;
  goldenStats: Array<{
    procName: string;
    total: number;
    ok: number;
    failed: number;
    hasGoldenFile: boolean;
  }>;
}
export interface AuditModuleResult {
  markdown: string;
  error?: string;
  raw?: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

export async function auditModule(opts: {
  module: string;
  input: AuditModuleInput;
  companyId?: string;
}): Promise<AuditModuleResult> {
  const styleGuide = loadStyleGuide();
  const prompt = loadPrompt("audit-module").replace("{STYLE_GUIDE}", styleGuide);

  // Truncate code dài để tiết kiệm token — proc/plugin > 4000 char giữ
  // 4000 đầu + dòng "...truncated".
  const truncate = (s: string, max: number): string =>
    s.length > max ? s.slice(0, max) + "\n// ... (truncated)" : s;

  const compactInput = {
    ...opts.input,
    procedures: opts.input.procedures.map((p) => ({
      ...p,
      code: truncate(p.code, 4000),
    })),
    plugins: opts.input.plugins.map((p) => ({
      ...p,
      code: truncate(p.code, 4000),
    })),
  };

  const userPayload = JSON.stringify(compactInput);

  const t0 = Date.now();
  // Audit response là Markdown — không expect JSON. Dùng callLlmJsonWithUsage
  // chỉ để có tokens; parse fail OK, lấy `raw`.
  const { callLlmJsonWithUsage } = await import("./llm-json.js");
  const { db } = await import("./db.js");
  const companyId = opts.companyId ?? (await (await import("./llm-client.js")).resolveCompanyId());

  const r = await callLlmJsonWithUsage<Record<string, unknown>>(db, companyId, {
    system: prompt,
    user: userPayload,
    maxTokens: 4000,
    temperature: 0.3,
  });

  // AI trả Markdown thuần → r.output sẽ null + r.raw chứa markdown.
  // Nếu AI trả nhầm JSON, fallback dùng JSON.stringify.
  const markdown =
    r.raw && r.raw.trim().length > 0 ? r.raw : r.output ? JSON.stringify(r.output, null, 2) : "";

  // Log vào ai-log/.
  const { writeFileSync, mkdirSync, existsSync } = await import("node:fs");
  const { resolve, dirname } = await import("node:path");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = resolve(
    process.cwd(),
    "migration-plan",
    "ai-log",
    opts.module,
    `audit-module-${ts}.json`,
  );
  if (!existsSync(dirname(logPath))) mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(
    logPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        module: opts.module,
        phase: "audit-module",
        companyId,
        tokensIn: r.usageIn,
        tokensOut: r.usageOut,
        usageReal: r.usageIn > 0,
        error: r.error,
        markdownLength: markdown.length,
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    markdown,
    error: r.error,
    raw: r.raw,
    tokensIn: r.usageIn,
    tokensOut: r.usageOut,
    durationMs: Date.now() - t0,
  };
}

/** Tier 3: sinh test sample input cho 1 proc — AI đọc paramsSchema từ
 *  MSSQL + 5 sample data của các bảng proc đụng → output 10 input variants
 *  (happy/boundary/edge). Output dùng cho capture-golden. */
export interface ProcSample {
  name: string;
  kind: "happy" | "boundary" | "edge";
  description: string;
  args: Record<string, unknown>;
  expectedError?: string;
}
export interface GenerateSamplesResult {
  procName: string;
  samples: ProcSample[];
  error?: string;
  raw?: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

export async function generateProcSamples(opts: {
  module: string;
  procName: string;
  mssqlClient: MssqlClient;
  companyId?: string;
  sampleRowsPerTable?: number;
}): Promise<GenerateSamplesResult> {
  const m = readManifest(opts.module);
  const proc = m.procs.find((p) => p.name === opts.procName);
  if (!proc) {
    return {
      procName: opts.procName,
      samples: [],
      error: `not_found: proc "${opts.procName}" không có trong manifest`,
      tokensIn: 0,
      tokensOut: 0,
      durationMs: 0,
    };
  }

  // Lấy paramsSchema từ MSSQL (sys.parameters qua client.getProc).
  let paramsSchema: Array<{ name: string; dataType: string; isOutput: boolean }> = [];
  try {
    const [sch, name] = proc.name.split(".");
    if (sch && name) {
      const p = await opts.mssqlClient.getProc(sch, name);
      paramsSchema = (p?.parameters ?? []).map((x) => ({
        name: x.name,
        dataType: x.dataType,
        isOutput: x.isOutput,
      }));
    }
  } catch (e) {
    return {
      procName: opts.procName,
      samples: [],
      error: `mssql_read_proc_fail: ${(e as Error).message}`,
      tokensIn: 0,
      tokensOut: 0,
      durationMs: 0,
    };
  }

  if (paramsSchema.length === 0) {
    return {
      procName: opts.procName,
      samples: [],
      tokensIn: 0,
      tokensOut: 0,
      durationMs: 0,
    };
  }

  // Lấy sample data cho mỗi bảng proc đọc.
  const limit = opts.sampleRowsPerTable ?? 5;
  const tableSamples: Record<string, unknown[]> = {};
  for (const tName of proc.reads ?? []) {
    try {
      const rows = await opts.mssqlClient.bulkRead<Record<string, unknown>>(tName, { limit });
      tableSamples[tName] = rows;
    } catch {
      tableSamples[tName] = [];
    }
  }

  const styleGuide = loadStyleGuide();
  const prompt = loadPrompt("samples-proc").replace("{STYLE_GUIDE}", styleGuide);

  const userPayload = JSON.stringify({
    procName: proc.name,
    paramsSchema,
    readsTables: proc.reads ?? [],
    tableSamples,
  });

  const t0 = Date.now();
  const r = await callAi<{ samples?: ProcSample[] }>(
    {
      module: opts.module,
      phase: `samples-${proc.name.replace(/\W/g, "_")}`,
      companyId: opts.companyId,
    },
    { system: prompt, user: userPayload, maxTokens: 3500, temperature: 0.4 },
  );

  return {
    procName: opts.procName,
    samples: r.output?.samples ?? [],
    error: r.error,
    raw: r.raw,
    tokensIn: r.tokensInApprox,
    tokensOut: r.tokensOutApprox,
    durationMs: Date.now() - t0,
  };
}

/** Tier 2: codegen 1 proc — dịch T-SQL → JS (tier B) hoặc TS (tier D)
 *  qua AI. Output là CODE PREVIEW, KHÔNG ghi gì cả. Caller (UI) confirm
 *  rồi gọi apply riêng để save vào DB (tier B) hoặc ghi file (tier D). */
export interface CodegenProcResultB {
  tier: "B";
  name: string;
  label: string;
  description: string;
  paramsSchema: Array<Record<string, unknown>>;
  code: string;
}
export interface CodegenProcResultD {
  tier: "D";
  fileName: string;
  exportName: string;
  description: string;
  code: string;
}
export interface CodegenProcResult {
  procName: string;
  manifestTier: "B" | "C" | "D";
  output: CodegenProcResultB | CodegenProcResultD | null;
  error?: string;
  raw?: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

export async function codegenProc(opts: {
  module: string;
  procName: string;
  mssqlClient: MssqlClient;
  companyId?: string;
}): Promise<CodegenProcResult> {
  const m = readManifest(opts.module);
  const proc = m.procs.find((p) => p.name === opts.procName);
  if (!proc) {
    return {
      procName: opts.procName,
      manifestTier: "B",
      output: null,
      error: `not_found: proc "${opts.procName}" không có trong manifest`,
      tokensIn: 0,
      tokensOut: 0,
      durationMs: 0,
    };
  }
  const tier = proc.suggestedTier ?? "B";
  if (tier === "C") {
    return {
      procName: opts.procName,
      manifestTier: "C",
      output: null,
      error: `tier_c: proc tier C (workflow scheduled) — chưa hỗ trợ codegen. Sinh tay workflow + body gọi proc B/D đã port.`,
      tokensIn: 0,
      tokensOut: 0,
      durationMs: 0,
    };
  }

  // Load body T-SQL.
  let body = "";
  try {
    const [sch, name] = proc.name.split(".");
    if (sch && name) {
      const p = await opts.mssqlClient.getProc(sch, name);
      body = p?.body ?? "";
    }
  } catch (e) {
    return {
      procName: opts.procName,
      manifestTier: tier,
      output: null,
      error: `mssql_read_proc_fail: ${(e as Error).message}`,
      tokensIn: 0,
      tokensOut: 0,
      durationMs: 0,
    };
  }
  if (body.length > 6000) body = body.slice(0, 6000) + "\n-- ... (truncated)";

  // Build entities map (chỉ entity, không enum — enum không có field schema).
  const entities = Object.fromEntries(
    m.tables
      .filter((t) => (t.suggestedKind ?? "entity") === "entity")
      .map((t) => [
        t.name,
        {
          entityName: t.suggestedEntityName,
          fieldNames: (t.columns ?? []).map((c) => c.mapTo?.field).filter((x): x is string => !!x),
        },
      ]),
  );

  const styleGuide = loadStyleGuide();
  const promptName = tier === "B" ? "codegen-procedure" : "codegen-plugin";
  const prompt = loadPrompt(promptName).replace("{STYLE_GUIDE}", styleGuide);

  const userPayload = JSON.stringify({
    procName: proc.name,
    body,
    targetProcName: proc.targetProcName,
    targetFile: proc.targetFile,
    entities,
    parseAnalysis: {
      readsTables: proc.reads,
      writesTables: proc.writes,
      flags: proc.flags,
    },
  });

  const t0 = Date.now();
  const r =
    tier === "B"
      ? await callAi<CodegenProcResultB>(
          {
            module: opts.module,
            phase: `codegen-procedure-${proc.name.replace(/\W/g, "_")}`,
            companyId: opts.companyId,
          },
          { system: prompt, user: userPayload, maxTokens: 3500, temperature: 0.2 },
        )
      : await callAi<CodegenProcResultD>(
          {
            module: opts.module,
            phase: `codegen-plugin-${proc.name.replace(/\W/g, "_")}`,
            companyId: opts.companyId,
          },
          { system: prompt, user: userPayload, maxTokens: 4000, temperature: 0.2 },
        );

  let output: CodegenProcResultB | CodegenProcResultD | null = null;
  if (r.output) {
    // AI prompt yêu cầu output không có field `tier` — ta gán theo manifestTier.
    output =
      tier === "B"
        ? { ...(r.output as Omit<CodegenProcResultB, "tier">), tier: "B" }
        : { ...(r.output as Omit<CodegenProcResultD, "tier">), tier: "D" };
  }

  return {
    procName: opts.procName,
    manifestTier: tier,
    output,
    error: r.error,
    raw: r.raw,
    tokensIn: r.tokensInApprox,
    tokensOut: r.tokensOutApprox,
    durationMs: Date.now() - t0,
  };
}

/** Helper: AI normalize naming cho cả module — đọc toàn bộ entity/enum/
 *  proc và suggest renames để consistent. KHÔNG apply tự động — trả về
 *  cho UI hiển thị + user chọn apply qua applyChange. */
export interface NormalizeRename {
  kind: "entity" | "enum" | "field" | "proc";
  table?: string; // MSSQL table name (cho entity/enum/field)
  column?: string; // MSSQL column name (cho field)
  currentName: string;
  suggestedName: string;
  reason: string;
  severity: "high" | "medium" | "low";
}

export interface NormalizeNamesResult {
  renames: NormalizeRename[];
  summary?: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  error?: string;
  raw?: string;
}

export async function normalizeNames(opts: {
  module: string;
  companyId?: string;
}): Promise<NormalizeNamesResult> {
  const m = readManifest(opts.module);
  const styleGuide = loadStyleGuide();
  const prompt = loadPrompt("normalize-names").replace("{STYLE_GUIDE}", styleGuide);

  // Build compact context — không gửi full body T-SQL để tiết kiệm token.
  const entities = m.tables
    .filter((t) => (t.suggestedKind ?? "entity") === "entity")
    .map((t) => ({
      table: t.name,
      name: t.suggestedEntityName,
      label: t.label,
      fieldNames: (t.columns ?? []).map((c) => c.mapTo?.field).filter((x): x is string => !!x),
    }));
  const enumsList = m.tables
    .filter((t) => t.suggestedKind === "enum")
    .map((t) => ({
      table: t.name,
      name: t.suggestedEntityName,
      label: t.label,
      valueCount: t.enumOptions?.length ?? 0,
    }));
  const procs = m.procs.map((p) => ({
    name: p.name,
    targetProcName: p.targetProcName,
    tier: p.suggestedTier,
  }));

  const userPayload = JSON.stringify({ entities, enums: enumsList, procs }, null, 2);

  const t0 = Date.now();
  const r = await callAi<{
    renames?: NormalizeRename[];
    summary?: string;
  }>(
    { module: opts.module, phase: "normalize-names", companyId: opts.companyId },
    { system: prompt, user: userPayload, maxTokens: 3000, temperature: 0.2 },
  );
  return {
    renames: r.output?.renames ?? [],
    summary: r.output?.summary,
    tokensIn: r.tokensInApprox,
    tokensOut: r.tokensOutApprox,
    durationMs: Date.now() - t0,
    error: r.error,
    raw: r.raw,
  };
}

/** Helper: enrich CHỈ 1 proc, không ghi manifest, trả output trực tiếp.
 *  Dùng cho endpoint sync `migration.enrichProcDryRun` (UI hiện kết quả
 *  ngay, không cần queue + poll). Caller PHẢI close mssqlClient. */
export interface EnrichOneProcResult {
  procName: string;
  output: unknown | null;
  error?: string;
  raw?: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

export async function enrichOneProc(opts: {
  module: string;
  procName: string;
  mssqlClient: MssqlClient;
  companyId?: string;
}): Promise<EnrichOneProcResult> {
  const m = readManifest(opts.module);
  const proc = m.procs.find((p) => p.name === opts.procName);
  if (!proc) {
    return {
      procName: opts.procName,
      output: null,
      error: `not_found: proc "${opts.procName}" không có trong manifest`,
      tokensIn: 0,
      tokensOut: 0,
      durationMs: 0,
    };
  }
  const styleGuide = loadStyleGuide();
  const promptProc = loadPrompt("enrich-proc").replace("{STYLE_GUIDE}", styleGuide);
  const enrichedTableMap = Object.fromEntries(m.tables.map((t) => [t.name, t.suggestedEntityName]));

  let body = "";
  try {
    const [sch, name] = proc.name.split(".");
    if (sch && name) {
      const p = await opts.mssqlClient.getProc(sch, name);
      body = p?.body ?? "";
    }
  } catch (e) {
    return {
      procName: opts.procName,
      output: null,
      error: `mssql_read_proc_fail: ${(e as Error).message}`,
      tokensIn: 0,
      tokensOut: 0,
      durationMs: 0,
    };
  }
  if (body.length > 6000) body = body.slice(0, 6000) + "\n-- ... (truncated)";

  const userPayload = JSON.stringify({
    procName: proc.name,
    body,
    parseAnalysis: {
      readsTables: proc.reads,
      writesTables: proc.writes,
      flags: proc.flags,
      suggestedTier: proc.suggestedTier,
    },
    tablesEnriched: enrichedTableMap,
  });

  const t0 = Date.now();
  const r = await callAi<EnrichedProcOutput>(
    {
      module: opts.module,
      phase: `enrich-proc-${proc.name.replace(/\W/g, "_")}`,
      companyId: opts.companyId,
    },
    { system: promptProc, user: userPayload, maxTokens: 1000, temperature: 0.2 },
  );
  return {
    procName: opts.procName,
    output: r.output,
    error: r.error,
    raw: r.raw,
    tokensIn: r.tokensInApprox,
    tokensOut: r.tokensOutApprox,
    durationMs: Date.now() - t0,
  };
}

function applyTableEnrichment(t: ManifestTable, e: EnrichedTableOutput): void {
  t.suggestedEntityName = e.suggestedEntityName;
  t.label = e.label;
  t.description = e.description;
  t.suggestedKind = e.suggestedKind ?? "entity";
  t.enrichedAt = new Date().toISOString();
  if (e.suggestedKind === "enum") {
    t.enumOptions = e.enumOptions ?? [];
  } else {
    delete t.enumOptions;
  }
  // Map column theo originalName.
  for (const col of e.columns) {
    const target = t.columns.find((c) => c.name === col.originalName);
    if (!target) continue;
    target.mapTo = {
      field: col.field,
      entityType: col.entityType,
      options: col.options,
      relationEntity: col.relationEntity,
    };
    // Lưu label/description vào mapTo extension.
    (
      target.mapTo as typeof target.mapTo & {
        label?: string;
        description?: string;
        required?: boolean;
      }
    ).label = col.label;
    (
      target.mapTo as typeof target.mapTo & {
        label?: string;
        description?: string;
        required?: boolean;
      }
    ).description = col.description;
    (
      target.mapTo as typeof target.mapTo & {
        label?: string;
        description?: string;
        required?: boolean;
      }
    ).required = col.required;
  }
}

function applyProcEnrichment(p: ManifestProc, e: EnrichedProcOutput, moduleName: string): void {
  p.enrichedAt = new Date().toISOString();
  p.suggestedTier = e.tier;
  if (e.tier === "B" && e.targetProcName) {
    p.targetProcName = e.targetProcName;
    p.targetFile = undefined;
  } else if (e.tier === "D") {
    const fileName = (e.targetProcName ?? procShort(p.name)).replace(/\W/g, "_").toLowerCase();
    p.targetFile = e.targetFile ?? `packages/plugins/module-${moduleName}/${fileName}.ts`;
  } else if (e.tier === "C") {
    if (e.schedule) p.schedule = e.schedule;
  }
  (p as ManifestProc & { label?: string; description?: string; tierReason?: string }).label =
    e.label;
  (p as ManifestProc & { label?: string; description?: string; tierReason?: string }).description =
    e.description;
  (p as ManifestProc & { label?: string; description?: string; tierReason?: string }).tierReason =
    e.tierReason;
}

function procShort(full: string): string {
  return full.split(".").pop() ?? full;
}
