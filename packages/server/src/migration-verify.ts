/* ==========================================================
   migration-verify.ts — Phase A: verify proc đã migrate so với golden
   baseline (output thật chạy trên MSSQL), tự sinh diff để feed lại AI.

   Đây là ĐÒN BẨY chính cho tỉ lệ thành công: thay vì tin AI dịch T-SQL
   đúng, ta CHẠY proc đã port với chính input golden rồi so output.

   Lưu ý semantic gap (cố ý xử lý heuristic):
   - Golden output dùng TÊN CỘT MSSQL (PascalCase). Proc migrate trả
     FIELD entity (lowercase, có thể đổi tên). → so sánh KEY-INSENSITIVE
     theo multiset GIÁ TRỊ từng dòng, không so trực tiếp tên cột.
   - Input golden keyed theo param MSSQL (@OrderId). Migrated proc nhận
     arg lowercase không @. → normalize key trước khi gọi.
   Đây là kiểm tra HÀNH VI xấp xỉ (rất tốt so với không check gì); case
   nhập nhằng vẫn cần người xác nhận.
   ========================================================== */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import type { DB } from "./db";
import { makeCallTool } from "./mcp-client";
import { makeInvokeProcedure } from "./procedure-runner";

/* ─── Manifest (đọc đủ field cần) ─── */

interface ManifestProcLite {
  name: string;
  suggestedTier?: "A" | "B" | "C" | "D";
  targetProcName?: string;
  targetFile?: string;
  active?: boolean;
  verifiedAt?: string;
}
interface ManifestLite {
  module: string;
  procs?: ManifestProcLite[];
}

const MIGRATION_ROOT = () => resolve(process.cwd(), "migration-plan");
const modulePath = (module: string) => resolve(MIGRATION_ROOT(), "modules", `${module}.yaml`);

function readManifestLite(module: string): ManifestLite | null {
  const p = modulePath(module);
  if (!existsSync(p)) return null;
  return YAML.parse(readFileSync(p, "utf8")) as ManifestLite;
}

/** Tên để invoke proc đã migrate: Tier B = targetProcName; Tier D = basename
 *  file (không .ts). makeInvokeProcedure tự tra procedures table rồi fallback
 *  module-procs registry nên 1 tên dùng cho cả 2 tier. */
function resolveInvokeName(proc: ManifestProcLite): string | null {
  if (proc.targetProcName) return proc.targetProcName;
  if (proc.targetFile) {
    return proc.targetFile.split(/[\\/]/).pop()?.replace(/\.ts$/, "") ?? null;
  }
  return null;
}

/* ─── Golden file ─── */

interface GoldenCase {
  name: string;
  kind: "happy" | "boundary" | "edge";
  description?: string;
  input: Record<string, unknown>;
  expectedError?: string;
  result?: { ok: boolean; output?: unknown; error?: string; durationMs?: number } | null;
}
interface GoldenFile {
  procName: string;
  capturedAt: string;
  cases: GoldenCase[];
}

function loadGolden(module: string, procName: string): GoldenFile | null {
  const safe = procName.replace(/\W/g, "_") + ".json";
  const p = resolve(MIGRATION_ROOT(), "..", "e2e", "golden", module, safe);
  // process.cwd() là gốc repo → e2e/golden/<module>/<safe>.json
  const alt = resolve(process.cwd(), "e2e", "golden", module, safe);
  const file = existsSync(alt) ? alt : existsSync(p) ? p : null;
  if (!file) return null;
  return JSON.parse(readFileSync(file, "utf8")) as GoldenFile;
}

/* ─── Chuẩn hoá + so sánh (PURE — unit-test được) ─── */

/** Chuẩn hoá 1 giá trị scalar cho so sánh: số làm tròn (khử nhiễu float),
 *  string trim, Date/ISO-string → epoch ms, bool/null giữ nguyên. */
export function canonScalar(v: unknown): string | number | boolean | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : 0;
  if (typeof v === "boolean") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    const s = v.trim();
    // ISO date-time → epoch để "2026-05-01T00:00:00Z" == Date tương ứng.
    const t = Date.parse(s);
    if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s) && !Number.isNaN(t)) return t;
    // Số dạng chuỗi "1.00" == 1.
    if (/^-?\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1e6) / 1e6;
    return s;
  }
  return JSON.stringify(v);
}

/** Canonical 1 dòng → chuỗi ổn định theo MULTISET GIÁ TRỊ (bỏ tên cột để
 *  miễn nhiễm đổi tên cột→field). Object: sort canon-value; array: recurse. */
export function canonRow(row: unknown): string {
  if (Array.isArray(row)) return "[" + row.map(canonRow).sort().join(",") + "]";
  // Date là object trong JS → phải bắt TRƯỚC nhánh object, nếu không Object.values
  // ra [] và mọi Date đều bằng nhau ("{}"). Giao cho canonScalar (→ epoch).
  if (row instanceof Date) return JSON.stringify(canonScalar(row));
  if (row && typeof row === "object") {
    const vals = Object.values(row as Record<string, unknown>)
      .map(canonRow)
      .sort();
    return "{" + vals.join(",") + "}";
  }
  return JSON.stringify(canonScalar(row));
}

/** Trích danh sách dòng từ output proc (golden hoặc migrated). Hỗ trợ:
 *  array thẳng, {rows:[...]}, {recordset:[...]}, {output:[...]}, scalar→[scalar]. */
export function extractRows(output: unknown): unknown[] {
  if (output == null) return [];
  if (Array.isArray(output)) {
    // execProc đôi khi trả mảng-của-recordset ([[...]]) — flatten 1 cấp nếu
    // mọi phần tử là array.
    if (output.length > 0 && output.every((x) => Array.isArray(x))) {
      return (output as unknown[][]).flat();
    }
    return output;
  }
  if (typeof output === "object") {
    const o = output as Record<string, unknown>;
    for (const k of ["rows", "recordset", "recordsets", "output", "result", "data"]) {
      if (Array.isArray(o[k])) return extractRows(o[k]);
    }
    return [output];
  }
  return [output];
}

export interface GoldenCompare {
  match: boolean;
  similarity: number; // 0..1 — tỉ lệ dòng expected khớp
  expectedRows: number;
  actualRows: number;
  missing: number; // dòng expected không thấy ở actual
  extra: number; // dòng actual thừa
  note: string;
}

/** So output migrated vs golden expected theo multiset dòng (order-insensitive,
 *  key-insensitive). */
export function compareGolden(expected: unknown, actual: unknown): GoldenCompare {
  const exp = extractRows(expected).map(canonRow);
  const act = extractRows(actual).map(canonRow);
  const expCount = new Map<string, number>();
  for (const r of exp) expCount.set(r, (expCount.get(r) ?? 0) + 1);
  const actCount = new Map<string, number>();
  for (const r of act) actCount.set(r, (actCount.get(r) ?? 0) + 1);

  let matched = 0;
  let missing = 0;
  for (const [r, n] of expCount) {
    const m = Math.min(n, actCount.get(r) ?? 0);
    matched += m;
    missing += n - m;
  }
  let extra = 0;
  for (const [r, n] of actCount) {
    extra += n - Math.min(n, expCount.get(r) ?? 0);
  }
  const similarity = exp.length === 0 ? (act.length === 0 ? 1 : 0) : matched / exp.length;
  const match = missing === 0 && extra === 0;
  const note = match
    ? "khớp hoàn toàn"
    : `${matched}/${exp.length} dòng khớp; thiếu ${missing}, thừa ${extra}`;
  return {
    match,
    similarity,
    expectedRows: exp.length,
    actualRows: act.length,
    missing,
    extra,
    note,
  };
}

/* ─── Replay 1 proc vs golden ─── */

/** Normalize input golden (param MSSQL "@OrderId") → arg migrated (lowercase). */
function normalizeArgs(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k.replace(/^@/, "").toLowerCase()] = v;
  }
  return out;
}

export interface ProcVerifyCaseResult {
  name: string;
  kind: string;
  ok: boolean; // case này pass (output khớp / lỗi đúng kỳ vọng)
  reason: string;
  compare?: GoldenCompare;
  /** Diff gọn để feed AI khi fail. */
  diff?: { input: unknown; expected: unknown; actual: unknown };
}

export interface ProcVerifyResult {
  module: string;
  procName: string;
  invokeName: string | null;
  tier: string;
  verified: boolean; // tất cả case pass
  totalCases: number;
  passedCases: number;
  cases: ProcVerifyCaseResult[];
  /** Tổng hợp diff các case fail — để nhúng vào prompt codegen lần sau. */
  feedback: string;
  error?: string;
}

/** Chạy proc đã migrate với từng input golden, so output. KHÔNG ghi gì. */
export async function verifyProcAgainstGolden(deps: {
  db: DB;
  companyId: string;
  module: string;
  procName: string;
  actorUserId?: string | null;
}): Promise<ProcVerifyResult> {
  const { db, companyId, module, procName } = deps;
  const base: ProcVerifyResult = {
    module,
    procName,
    invokeName: null,
    tier: "?",
    verified: false,
    totalCases: 0,
    passedCases: 0,
    cases: [],
    feedback: "",
  };

  const manifest = readManifestLite(module);
  const proc = manifest?.procs?.find((p) => p.name === procName);
  if (!proc) return { ...base, error: `Proc "${procName}" không có trong manifest module.` };
  base.tier = proc.suggestedTier ?? "?";
  const invokeName = resolveInvokeName(proc);
  base.invokeName = invokeName;
  if (!invokeName) {
    return { ...base, error: "Proc chưa có targetProcName/targetFile — chưa generate?" };
  }

  const golden = loadGolden(module, procName);
  if (!golden || golden.cases.length === 0) {
    return { ...base, error: "Chưa có golden baseline (chạy capture-golden trước)." };
  }

  const invoke = makeInvokeProcedure({
    db,
    companyId,
    callTool: makeCallTool(db, companyId),
    actorUserId: deps.actorUserId ?? null,
  });

  const cases: ProcVerifyCaseResult[] = [];
  for (const c of golden.cases) {
    const expectsError = !!c.expectedError || c.result?.ok === false;
    const args = normalizeArgs(c.input ?? {});
    try {
      const r = await invoke(invokeName, args);
      if (expectsError) {
        cases.push({
          name: c.name,
          kind: c.kind,
          ok: false,
          reason: "Golden kỳ vọng LỖI nhưng proc migrate chạy thành công.",
          diff: { input: c.input, expected: c.expectedError ?? "(error)", actual: r.output },
        });
        continue;
      }
      const cmp = compareGolden(c.result?.output, r.output);
      cases.push({
        name: c.name,
        kind: c.kind,
        ok: cmp.match,
        reason: cmp.note,
        compare: cmp,
        ...(cmp.match
          ? {}
          : { diff: { input: c.input, expected: c.result?.output, actual: r.output } }),
      });
    } catch (e) {
      const msg = (e as Error).message;
      if (expectsError) {
        cases.push({ name: c.name, kind: c.kind, ok: true, reason: `Lỗi đúng kỳ vọng: ${msg}` });
      } else {
        cases.push({
          name: c.name,
          kind: c.kind,
          ok: false,
          reason: `Proc migrate throw: ${msg}`,
          diff: { input: c.input, expected: c.result?.output, actual: `THROW: ${msg}` },
        });
      }
    }
  }

  const passed = cases.filter((x) => x.ok).length;
  const feedback = cases
    .filter((x) => !x.ok && x.diff)
    .map(
      (x) =>
        `Case "${x.name}" (${x.kind}): ${x.reason}\n` +
        `  input: ${JSON.stringify(x.diff!.input)}\n` +
        `  expected: ${truncate(JSON.stringify(x.diff!.expected), 1200)}\n` +
        `  actual: ${truncate(JSON.stringify(x.diff!.actual), 1200)}`,
    )
    .join("\n\n");

  return {
    ...base,
    verified: passed === cases.length && cases.length > 0,
    totalCases: cases.length,
    passedCases: passed,
    cases,
    feedback,
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…(cắt)" : s;
}
