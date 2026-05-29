/* ==========================================================
   migration-classify-ai.ts — Phân loại nghiệp vụ proc qua LLM.

   Input: T-SQL body + reads/writes metadata.
   Output: businessCategory enum + confidence 0-1 + reasoning.
   Persist: ghi vào manifest.procs[].businessCategory.

   Pure helper — caller (router) handle DB read/write của manifest.
   ========================================================== */

import { createHash } from "node:crypto";
import type { MssqlClient } from "@erp-framework/mssql-client";
import type { DB } from "./db";
import { callLlmJson } from "./llm-json";

/** Hash body T-SQL để check stale. Bỏ whitespace để không sensitive với re-format. */
export function bodyHash(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export type BusinessCategory =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "report"
  | "validation"
  | "calculation"
  | "workflow"
  | "trigger"
  | "batch"
  | "unknown";

export const ALL_CATEGORIES: BusinessCategory[] = [
  "create",
  "read",
  "update",
  "delete",
  "report",
  "validation",
  "calculation",
  "workflow",
  "trigger",
  "batch",
  "unknown",
];

export interface ProcClassifyInput {
  /** Tên đầy đủ schema.proc. */
  name: string;
  reads: string[];
  writes: string[];
  flags: string[];
  /** Để giới hạn 4000 ký tự đầu tiên — đủ context cho LLM. */
  body: string;
  /** Label/desc nếu có để giúp LLM. */
  label?: string;
  description?: string;
}

export interface ProcClassifyResult {
  name: string;
  category: BusinessCategory;
  confidence: number;
  reasoning?: string;
  recommendedTier?: "B" | "C" | "D";
}

const SYSTEM_PROMPT = `Bạn là kỹ sư phần mềm chuyên migrate hệ thống legacy MSSQL sang low-code.
Nhiệm vụ: phân loại mỗi stored procedure theo nghiệp vụ chính.

Output JSON với schema:
{
  "items": [
    {
      "name": "<tên proc>",
      "category": "create | read | update | delete | report | validation | calculation | workflow | trigger | batch | unknown",
      "confidence": <số 0-1>,
      "reasoning": "<1-2 câu giải thích ngắn tiếng Việt>",
      "recommendedTier": "B | C | D"
    }
  ]
}

Quy tắc phân loại (ưu tiên trên xuống):
- "trigger": proc được gọi từ MSSQL trigger hoặc tên có TRIGGER_
- "batch": proc chạy theo schedule (SQL Agent) — tên có DAILY/NIGHTLY/JOB
- "report": chủ yếu SELECT + JOIN, return rowset, không UPDATE/INSERT/DELETE
- "calculation": tính giá trị (SUM, AVG, ROUND...) + return scalar/rowset, ít/không ghi DB
- "validation": có RAISERROR/THROW/IF EXISTS check + minimal write
- "create": chủ yếu INSERT 1 bảng
- "update": chủ yếu UPDATE 1 bảng
- "delete": chủ yếu DELETE
- "workflow": nhiều branch IF/CASE/EXEC sub-proc + multiple writes → phù hợp visual workflow
- "read": SELECT đơn giản 1 bảng (CRUD read)
- "unknown": không xác định rõ

Quy tắc recommendedTier:
- "B" (Procedure JS isolated-vm): logic đơn giản, ít branch, có thể port 1:1
- "C" (Workflow visual): nhiều branch IF/CASE/EXEC → cần graph view
- "D" (Plugin TS file): logic phức tạp dynamic SQL/cursor/temp table — cần human review

confidence:
- 0.9+ : pattern rõ (chỉ SELECT → report)
- 0.6-0.8 : có thể classify nhưng có overlap
- < 0.5 : mơ hồ — fallback "unknown"
`;

export interface ClassifyBatchOpts {
  /** Tối đa proc 1 batch — tránh prompt quá dài. Default 5. */
  batchSize?: number;
  /** Truncate body mỗi proc — default 2000 ký tự. */
  bodyLimit?: number;
}

/** Classify nhiều proc 1 lượt. Chia thành batch nhỏ để LLM không bị truncate.
 *  Lỗi LLM (null) → bỏ batch đó (caller mark failed), không throw. */
export async function classifyProcsBatch(
  db: DB,
  companyId: string,
  procs: ProcClassifyInput[],
  opts: ClassifyBatchOpts = {},
): Promise<ProcClassifyResult[]> {
  const batchSize = opts.batchSize ?? 5;
  const bodyLimit = opts.bodyLimit ?? 2000;
  const out: ProcClassifyResult[] = [];

  for (let i = 0; i < procs.length; i += batchSize) {
    const slice = procs.slice(i, i + batchSize);
    const userPrompt = slice
      .map((p) => {
        const meta = [
          `# ${p.name}`,
          p.label ? `Label: ${p.label}` : "",
          p.description ? `Mô tả: ${p.description}` : "",
          `Reads: ${p.reads.join(", ") || "(none)"}`,
          `Writes: ${p.writes.join(", ") || "(none)"}`,
          p.flags.length > 0 ? `Flags: ${p.flags.join(", ")}` : "",
          "```sql",
          p.body.slice(0, bodyLimit),
          "```",
        ]
          .filter(Boolean)
          .join("\n");
        return meta;
      })
      .join("\n\n");

    const result = await callLlmJson<{ items?: ProcClassifyResult[] }>(db, companyId, {
      system: SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens: 2048,
      temperature: 0.2,
    });

    if (!result?.items) continue;

    for (const r of result.items) {
      // Sanitize: ép category về enum hợp lệ, clamp confidence.
      const cat = ALL_CATEGORIES.includes(r.category) ? r.category : "unknown";
      const conf = Math.min(1, Math.max(0, Number(r.confidence) || 0));
      const tier = ["B", "C", "D"].includes(r.recommendedTier as string)
        ? (r.recommendedTier as "B" | "C" | "D")
        : undefined;
      out.push({
        name: r.name,
        category: cat,
        confidence: conf,
        reasoning: r.reasoning,
        recommendedTier: tier,
      });
    }
  }

  return out;
}

/** Helper: lấy body T-SQL của 1 proc từ MSSQL client. */
export async function fetchProcBody(mssql: MssqlClient, procName: string): Promise<string> {
  // procName dạng schema.name — split cho getProc.
  const [schemaPart, namePart] = procName.includes(".") ? procName.split(".") : ["dbo", procName];
  if (!schemaPart || !namePart) return "";
  try {
    const info = await mssql.getProc(schemaPart, namePart);
    return info?.body ?? "";
  } catch {
    return "";
  }
}
