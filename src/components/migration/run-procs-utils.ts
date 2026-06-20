/* RunAllProcsScreen — types + constants + helper thuần (persist localStorage,
   khớp từ khoá proc). Tách từ RunAllProcsScreen.tsx (pilot refactor). */
import { createMigrationClient } from "@erp-framework/client";

const migration = createMigrationClient("");

export const CONN_LS_KEY = "migrate-proc-conn-id";

export type ListData = Awaited<ReturnType<typeof migration.listAllProcsToMigrate>>;
export type ProcRow = ListData["rowsByModule"][string][number];
export type ClassifyMode = "skip-existing" | "if-stale" | "force";

/** Nhật ký 1 dòng — append vào runLogs trong suốt session. */
export interface RunLogEntry {
  id: string;
  at: string;
  /** Bước trong flow runMigrateAll. "info" cho header/footer phụ. */
  step: "1/3" | "2/3" | "2b/3" | "3/3" | "info";
  /** Hành động: classify proc, codegen workflow/B/D, apply FK, hoặc info. */
  action: "classify" | "workflow" | "codegen" | "fk" | "info";
  /** Target text: tên module, tên proc, hoặc entity.field. */
  target: string;
  /** Kết quả: started/success/skipped/cached/noop/failed. */
  result: "started" | "success" | "skipped" | "cached" | "noop" | "failed";
  /** Mô tả thêm — vd error message hay counts. */
  detail?: string;
}

export const RESULT_COLORS: Record<RunLogEntry["result"], string> = {
  started: "text-accent",
  success: "text-success",
  skipped: "text-muted",
  cached: "text-muted italic",
  noop: "text-muted italic",
  failed: "text-danger",
};

export const RESULT_BADGE: Record<RunLogEntry["result"], string> = {
  started: "▶",
  success: "✓",
  skipped: "↷",
  cached: "⟲",
  noop: "≡",
  failed: "✗",
};

export const TIER_COLORS: Record<string, string> = {
  B: "bg-accent/15 text-accent border-accent/30",
  C: "bg-warning/15 text-warning border-warning/30",
  D: "bg-danger/15 text-danger border-danger/30",
};

/* ── Persist trạng thái UI vào localStorage ─────────────────────────────
   Kết quả migrate thật lưu server-side (manifest/procedures/decisions); ở
   đây chỉ persist working-set của màn (bộ lọc, proc đã tick, nhật ký) để
   mở lại / F5 không reset. */
export const LS_KEY = "migrate-proc-screen:v1";
export const RUNLOGS_CAP = 500; // giữ N dòng nhật ký mới nhất, tránh phình localStorage.

export interface PersistedFilters {
  filterMode: "all" | "reads-only";
  activeDays: number;
  sortBy: "complexity-asc" | "complexity-desc" | "name";
  moduleFilter: string;
  procNameFilter: string;
  codegenFilter: "all" | "done" | "pending";
  classifyMode: ClassifyMode;
}

export function loadLS<T>(sub: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`${LS_KEY}:${sub}`);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
export function saveLS(sub: string, val: unknown): void {
  try {
    localStorage.setItem(`${LS_KEY}:${sub}`, JSON.stringify(val));
  } catch {
    /* quota đầy / localStorage tắt — bỏ qua, không vỡ UI */
  }
}

/** Khớp từ khoá với proc theo TÊN máy + NHÃN + NGHIỆP VỤ (client-side). */
export function procTextMatch(row: ProcRow, term: string): boolean {
  return (
    row.name.toLowerCase().includes(term) ||
    (row.label?.toLowerCase().includes(term) ?? false) ||
    (row.businessCategory?.toLowerCase().includes(term) ?? false)
  );
}
