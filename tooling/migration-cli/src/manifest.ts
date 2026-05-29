/* ==========================================================
   manifest.ts — Read/write YAML manifest per module.
   Schema được định nghĩa loose — tạo bởi discover, sửa tay
   bởi human, đọc lại bởi generate/capture-golden/data.
   ========================================================== */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import YAML from "yaml";
import type { ProcAnalysis, JoinPair } from "@erp-framework/mssql-client";

/** Vị trí mặc định — repo-relative. */
export function manifestPath(moduleName: string): string {
  return resolve(process.cwd(), "migration-plan", "modules", `${moduleName}.yaml`);
}

export interface ManifestColumn {
  name: string;
  type: string;
  isNullable: boolean;
  /** Cấu hình map sang entity field — generator dùng. */
  mapTo?: {
    field: string;
    entityType: string;
    options?: string[];
    relationEntity?: string;
  };
}

export interface ManifestTable {
  name: string; // schema.table
  suggestedEntityName: string; // snake_case
  primaryKey: string[];
  columns: ManifestColumn[];
  inferredRelations?: Array<{
    column: string;
    refTable: string;
    refColumn: string;
    sourceProc: string;
  }>;
  /** AI enrich (Tier 1) gán — quyết định bảng là entity (mặc định)
   *  hay enum (lookup nhỏ, không cần sinh entity). */
  suggestedKind?: "entity" | "enum";
  /** Có khi suggestedKind=enum — list label tiếng Việt có dấu. */
  enumOptions?: string[];
  /** Split rules: 1 bảng MSSQL → N enum theo discriminator. Dùng cho
   *  pattern bảng `DM_HE_THONG` chung có cột LOAI phân loại. Khi có
   *  splitEnums[], materialize tạo nhiều record `enums` với WHERE filter. */
  splitEnums?: Array<{
    /** Tên cột discriminator (vd LOAI, TYPE, CATEGORY). */
    discriminatorColumn: string;
    /** Giá trị filter (vd "TRANG_THAI_DON"). */
    discriminatorValue: string;
    /** Tên enum sinh ra (snake_case không dấu). */
    name: string;
    /** Label tiếng Việt có dấu. */
    label: string;
    description?: string;
    /** Override cột làm value (default = primary key của bảng). */
    valueColumn?: string;
    /** Override cột làm label (default = cột TEN/NAME/LABEL). */
    labelColumn?: string;
    /** Extra columns mỗi value lưu vào metadata. */
    extraColumns?: string[];
  }>;
  /** AI enrich gán — label tiếng Việt có dấu cho UI. */
  label?: string;
  /** AI enrich gán — mô tả nghiệp vụ. */
  description?: string;
  /** Phase Q3 — timestamp ETL bulk-read thành công cho bảng này.
   *  Codegen guard check field này để cho phép sinh code proc đụng bảng này. */
  migratedAt?: string;
  /** Phase Q3 — kết quả lần migrate cuối: số row read/upsert. */
  migrateStats?: {
    rowsRead: number;
    rowsUpserted: number;
    errors: number;
  };
}

export interface ManifestProc {
  name: string;
  reads: string[];
  writes: string[];
  flags: string[];
  suggestedTier: "B" | "C" | "D";
  /** Cho tier B — tên procedure trong framework sau khi port. */
  targetProcName?: string;
  /** Cho tier D — file plugin sinh ra. */
  targetFile?: string;
  /** Cho tier C — cron expression nếu detect được từ SQL Agent. */
  schedule?: string;
  /** Cây gọi proc khác, dùng để generator topo sort. */
  callsProcs?: string[];
  /** AI enrich gán — nhãn tiếng Việt có dấu. */
  label?: string;
  /** AI enrich gán — mô tả nghiệp vụ. */
  description?: string;
  /** AI enrich gán — lý do chọn tier (debug). */
  tierReason?: string;
  /** Phase Q1 — proc có còn được dùng không. Mặc định true.
   *  false = mark dead, skip codegen + bỏ khỏi live tables aggregation. */
  active?: boolean;
  /** Phase Q1 — ISO timestamp lần gọi cuối (sys.dm_exec_procedure_stats).
   *  null = không có entry trong plan cache (chưa gọi kể từ restart hoặc evicted). */
  lastExecAt?: string | null;
  /** Phase Q1 — tổng số lần gọi kể từ MSSQL restart gần nhất. */
  execCount?: number;
  /** Phase Q1 — ISO timestamp lần đọc proc-stats. Để biết data này tươi hay cũ. */
  statsLastReadAt?: string;
  /** V2 — AI phân loại nghiệp vụ proc.
   *  create/read/update/delete: CRUD đơn giản
   *  report: SELECT-heavy, aggregation, export
   *  validation: kiểm tra rule + raise error
   *  calculation: tính toán chỉ số, không ghi DB
   *  workflow: nhiều branch IF/EXEC — phù hợp tier C
   *  trigger: chạy on data-change (rare)
   *  batch: chạy theo schedule (rare) */
  businessCategory?:
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
  /** Confidence 0-1 từ AI khi gán businessCategory. */
  businessCategoryConfidence?: number;
  /** ISO timestamp lần AI classify gần nhất. */
  aiClassifiedAt?: string;
  /** User override sau khi AI classify — override này ưu tiên hơn AI. */
  userOverrideCategory?: ManifestProc["businessCategory"];
  /** Complexity score (số reads + writes*2 + joinPairs + flags*5). Tính
   *  on-demand nếu thiếu — dùng để sort proc đơn giản → phức tạp. */
  complexity?: number;
  /** sha256 (hex) của body T-SQL lần cuối được đọc. Dùng để skip classify
   *  hoặc workflow codegen nếu body chưa đổi → kết quả ổn định, không drift. */
  bodyHash?: string;
  /** Cache kết quả AI classify cuối — nếu bodyHash khớp, dùng cache thay vì
   *  gọi LLM (tiết kiệm chi phí + đảm bảo idempotent). */
  aiClassifyCache?: {
    bodyHash: string;
    category: ManifestProc["businessCategory"];
    confidence: number;
    reasoning?: string;
    recommendedTier?: "B" | "C" | "D";
    at: string;
  };
  /** Cache kết quả AI workflow codegen cuối — dryRun có thể tái dùng. */
  aiWorkflowCache?: {
    bodyHash: string;
    graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
    at: string;
  };
  /** ID workflow đã apply Tier C. Set khi codegenProcWorkflowApply chạy lần đầu. */
  targetWorkflowId?: string;
  targetWorkflowName?: string;
}

export interface ManifestCrossModuleEdge {
  proc: string;
  externalTable: string;
  kind: "read" | "write";
  suggestedContract?: string;
}

export interface ManifestStatus {
  phase: "discovered" | "scaffolded" | "filled" | "migrating" | "live" | "retired";
  capturedGoldenAt: string | null;
  scaffoldedAt: string | null;
  cutoverAt: string | null;
  retiredAt: string | null;
}

export interface Manifest {
  module: string;
  tables: ManifestTable[];
  procs: ManifestProc[];
  crossModuleEdges: ManifestCrossModuleEdge[];
  status: ManifestStatus;
  /** Lưu params của lần discover cuối — dùng cho refresh re-run. */
  discoverParams?: {
    seedTables: string[];
    excludeTables: string[];
    maxTables: number;
    lastRunAt: string;
  };
  /** Lưu lịch sử refresh để user biết bảng/cột nào mới so với lần trước. */
  lastRefresh?: {
    at: string;
    tablesAdded: string[];
    tablesRemoved: string[];
    procsAdded: string[];
    procsRemoved: string[];
    columnsAdded: Array<{ table: string; column: string }>;
    columnsRemoved: Array<{ table: string; column: string }>;
  };
}

export function readManifest(moduleName: string): Manifest {
  const p = manifestPath(moduleName);
  if (!existsSync(p)) {
    throw new Error(`Manifest không tồn tại: ${p}. Chạy 'pnpm migrate discover' trước.`);
  }
  return YAML.parse(readFileSync(p, "utf8")) as Manifest;
}

export function writeManifest(m: Manifest, outPath?: string): string {
  const p = outPath ?? manifestPath(m.module);
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // YAML.stringify giữ order key — manifest đọc ban đầu lần lượt.
  writeFileSync(p, YAML.stringify(m, { lineWidth: 0 }), "utf8");
  return p;
}

/** Tiện ích: convert ProcAnalysis từ mssql-client sang ManifestProc. */
export function toManifestProc(fullName: string, a: ProcAnalysis): ManifestProc {
  return {
    name: fullName,
    reads: a.readsTables,
    writes: a.writesTables,
    flags: a.flags,
    suggestedTier: a.suggestedTier,
    callsProcs: a.callsProcs.length > 0 ? a.callsProcs : undefined,
  };
}

/** Gộp join pair vào inferredRelations của tables. */
export function applyJoinPairs(tables: ManifestTable[], procName: string, pairs: JoinPair[]): void {
  for (const pair of pairs) {
    // Tìm table chứa leftColumn với schema.table khớp.
    const leftTbl = tables.find((t) => sameTable(t.name, pair.leftTable));
    if (!leftTbl) continue;
    const exists = (leftTbl.inferredRelations ?? []).some(
      (r) => r.column === pair.leftColumn && sameTable(r.refTable, pair.rightTable),
    );
    if (exists) continue;
    leftTbl.inferredRelations ??= [];
    leftTbl.inferredRelations.push({
      column: pair.leftColumn,
      refTable: pair.rightTable,
      refColumn: pair.rightColumn,
      sourceProc: procName,
    });
  }
}

function sameTable(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
