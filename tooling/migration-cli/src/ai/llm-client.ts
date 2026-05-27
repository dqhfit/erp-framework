/* ==========================================================
   llm-client.ts — Wrapper gọi `callLlmJson` từ CLI.

   Trách nhiệm:
   - Resolve `companyId` (qua arg --company-id, env, hoặc company đầu tiên).
   - Nạp style guide STYLE.md và prompt tiếng Việt vào mỗi LLM call.
   - Log prompt-response vào migration-plan/ai-log/<module>/<phase>-<ts>.json
     để audit + replay.
   - Track tokens approximate để cảnh báo cost.
   ========================================================== */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { companies } from "@erp-framework/db";
import { db } from "./db.js";
import { callLlmJsonWithUsage, type CallLlmJsonOpts } from "./llm-json.js";

export interface AiCallContext {
  /** Module đang process — dùng để phân loại ai-log/<module>/. */
  module: string;
  /** Phase logic: "enrich-table" | "enrich-proc" | "codegen-procedure" | ... */
  phase: string;
  /** Company target — fallback từ env CLI. */
  companyId?: string;
}

export interface AiCallResult<T> {
  output: T | null;
  /** Token usage thực từ API; nếu API không trả (Ollama / lỗi mạng) → approx. */
  tokensInApprox: number;
  tokensOutApprox: number;
  /** Khi output=null, error giải thích lý do — hiển thị lên UI để debug. */
  error?: string;
  /** Raw response từ API (chỉ khi parse fail) — dùng để xem AI nói gì. */
  raw?: string;
}

let cachedCompanyId: string | null = null;

/** Resolve company-id theo ưu tiên: arg (worker pass từ ctx.user.companyId)
 *  → env MIGRATION_COMPANY_ID (CLI standalone) → company đầu tiên (fallback). */
export async function resolveCompanyId(override?: string): Promise<string> {
  if (override) return override;
  if (cachedCompanyId) return cachedCompanyId;
  const envId = process.env.MIGRATION_COMPANY_ID;
  if (envId) {
    cachedCompanyId = envId;
    return envId;
  }
  // CLI không có worker context và env — fallback company đầu tiên.
  const [first] = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .limit(1);
  if (!first) {
    throw new Error(
      "Không tìm thấy company nào trong DB. Tạo company trước (qua API frontend) " +
        "hoặc đặt env MIGRATION_COMPANY_ID=<uuid>.",
    );
  }
  cachedCompanyId = first.id;
  console.log(`▸ Dùng company "${first.name}" (${first.id}) — fallback (CLI standalone).`);
  return first.id;
}

/** Đọc style guide từ repo. Cache trong session để không re-read. */
/** Đọc style guide MỖI lần — KHÔNG cache. File ~3KB. Cache khiến edit
 *  STYLE.md không có hiệu lực cho đến khi restart server (bug đã gặp). */
export function loadStyleGuide(): string {
  const p = resolve(process.cwd(), "migration-plan", "STYLE.md");
  if (!existsSync(p)) {
    console.warn(`! STYLE.md không tồn tại (${p}) — AI sẽ thiếu context naming Việt.`);
    return "";
  }
  return readFileSync(p, "utf8");
}

/** Đọc system prompt từ file ai/prompts/<name>.md. */
export function loadPrompt(name: string): string {
  const p = resolve(import.meta.dirname, "prompts", `${name}.md`);
  if (!existsSync(p)) {
    throw new Error(`Prompt không tồn tại: ${p}`);
  }
  return readFileSync(p, "utf8");
}

/** Gọi LLM 1 shot — bao gồm log + token estimate. */
export async function callAi<T = unknown>(
  ctx: AiCallContext,
  opts: CallLlmJsonOpts,
): Promise<AiCallResult<T>> {
  const companyId = await resolveCompanyId(ctx.companyId);
  const approxIn = Math.ceil((opts.system.length + opts.user.length) / 4);

  const t0 = Date.now();
  const r = await callLlmJsonWithUsage<T>(db, companyId, opts);
  const durationMs = Date.now() - t0;
  const approxOut = r.output ? Math.ceil(JSON.stringify(r.output).length / 4) : 0;

  // Ưu tiên usage thực; fallback approximate.
  const tokensInApprox = r.usageIn > 0 ? r.usageIn : approxIn;
  const tokensOutApprox = r.usageOut > 0 ? r.usageOut : approxOut;

  // Log prompt + response + error vào ai-log/.
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = resolve(
    process.cwd(),
    "migration-plan",
    "ai-log",
    ctx.module,
    `${ctx.phase}-${ts}.json`,
  );
  const logDir = dirname(logPath);
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  writeFileSync(
    logPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        module: ctx.module,
        phase: ctx.phase,
        companyId,
        durationMs,
        tokensIn: tokensInApprox,
        tokensOut: tokensOutApprox,
        usageReal: r.usageIn > 0,
        system: opts.system,
        user: opts.user,
        output: r.output,
        error: r.error,
        raw: r.raw,
      },
      null,
      2,
    ),
    "utf8",
  );

  if (!r.output) {
    console.warn(`! AI call fail (phase=${ctx.phase}): ${r.error ?? "unknown"}. Log: ${logPath}`);
  }

  return {
    output: r.output,
    tokensInApprox,
    tokensOutApprox,
    error: r.error,
    raw: r.raw,
  };
}

/** Tính chi phí USD (Claude Sonnet pricing 2026: $3/M input, $15/M output). */
export function estimateCostUsd(tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1_000_000) * 3 + (tokensOut / 1_000_000) * 15;
}
