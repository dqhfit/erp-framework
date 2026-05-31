/* ==========================================================
   legacy-report-parse.ts — Cockpit/report: trích blueprint XtraReports
   (class rpt_*) từ source C# DQHF.

   Report DQHF là code C#: <rpt>.Designer.cs chứa control (XRLabel/
   XRTableCell + .Text), <rpt>.cs (code-behind) chứa data proc (MyQuery)
   + BeforePrint. Parser trích: tiêu đề, data proc, cột (header cell),
   group, summary → đủ để dựng lại report dạng bảng (list page) hoặc làm
   spec cho template in (report chứng từ).
   ========================================================== */

import { existsSync, readFileSync } from "node:fs";
import { legacyMenuMap, legacyReports } from "@erp-framework/db";
import { and, eq, isNotNull } from "drizzle-orm";
import type { DB } from "./db";
import { type CSharpIndex, buildCSharpIndex } from "./legacy-menu-resolve";

const PROC_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Văn bản boilerplate/đầu trang — không phải tiêu đề/cột. */
const BOILER =
  /công ty|điện thoại|^đt:|^dđ:|email|mst|phường|quận|tỉnh|@|lập biểu|ngày .*tháng|^trang|^\d[\d.\s-]+$/i;
/** Nhãn footer chữ ký — không phải cột bảng. */
const SIGNATURE =
  /^(giám đốc|kế toán|thủ kho|người (giao|nhận|lập)|bên (giao|nhận)|người duyệt|ban giám đốc)/i;

export interface ReportBlueprint {
  reportClass: string;
  namespace: string | null;
  title: string | null;
  kind: "table" | "document";
  dataProcs: string[];
  columns: string[];
  groups: string[];
  summaries: string[];
  hasBeforePrint: number;
  note?: string;
}

/** Trích blueprint 1 report theo tên class (rpt_*). */
export function parseReport(idx: CSharpIndex, reportClass: string): ReportBlueprint {
  const base: ReportBlueprint = {
    reportClass,
    namespace: null,
    title: null,
    kind: "document",
    dataProcs: [],
    columns: [],
    groups: [],
    summaries: [],
    hasBeforePrint: 0,
  };
  const code = idx.fileByClass.get(reportClass.toLowerCase());
  if (!code) return { ...base, note: `Không thấy ${reportClass}.cs` };
  const designer = code.replace(/\.cs$/, ".Designer.cs");

  const cb = (() => {
    try {
      return readFileSync(code, "utf8");
    } catch {
      return "";
    }
  })();
  const dz = existsSync(designer) ? readFileSync(designer, "utf8") : "";

  // namespace
  const nsMatch = cb.match(/namespace\s+([A-Za-z0-9_.]+)/);
  const namespace = nsMatch?.[1] ?? null;

  // data procs (code-behind)
  const procs = new Set<string>();
  for (const m of cb.matchAll(/MyQuery\(\s*"([^"]+)"/g)) {
    if (PROC_ID.test(m[1]!)) procs.add(m[1]!);
  }

  // mọi <ctrl>.Text = "..."
  const texts: Array<{ ctrl: string; text: string }> = [];
  for (const m of dz.matchAll(/this\.(\w+)\.Text\s*=\s*"([^"]*)"/g)) {
    texts.push({ ctrl: m[1]!, text: m[2]!.replace(/\\r\\n.*$/s, "").trim() });
  }

  // tiêu đề: hoa, dài, không boilerplate, không kết thúc ":"
  const title =
    texts
      .map((t) => t.text)
      .filter((t) => t.length >= 8 && !BOILER.test(t) && !t.endsWith(":"))
      .filter((t) => {
        const letters = t.replace(/[^A-Za-zÀ-ỹ]/g, "");
        const upper = t.replace(/[^A-ZÀ-Ỹ]/g, "");
        return letters.length >= 5 && upper.length / letters.length > 0.6;
      })
      .sort((a, b) => b.length - a.length)[0] ?? null;

  // cột: text của xrTableCell, tĩnh, ngắn, không boilerplate/signature/title/":".
  const columns = [
    ...new Set(
      texts
        .filter((t) => /tablecell/i.test(t.ctrl))
        .map((t) => t.text.trim())
        .filter(
          (t) =>
            t.length >= 1 &&
            t.length <= 28 &&
            t !== title &&
            !t.endsWith(":") &&
            !BOILER.test(t) &&
            !SIGNATURE.test(t) &&
            !/^[\d.,%\s-]+$/.test(t) &&
            !/^xrtablecell/i.test(t),
        ),
    ),
  ];

  const groups = [
    ...new Set([...dz.matchAll(/GroupField\(\s*"([^"]+)"/g)].map((m) => m[1]!).filter(Boolean)),
  ];
  const summaries = [...new Set([...dz.matchAll(/SummaryFunc\.(\w+)/g)].map((m) => m[1]!))];
  const hasBeforePrint = (cb.match(/BeforePrint/g) ?? []).length;

  // table nếu có ≥3 cột header hoặc có group; còn lại là chứng từ in.
  const kind: "table" | "document" =
    columns.length >= 3 || groups.length > 0 ? "table" : "document";

  return {
    reportClass,
    namespace,
    title,
    kind,
    dataProcs: [...procs],
    columns,
    groups,
    summaries,
    hasBeforePrint,
  };
}

export interface ParseReportsResult {
  totalReports: number;
  parsed: number;
  table: number;
  document: number;
}

/** Parse mọi report được menu tham chiếu (legacy_menu_map.resolved.reports),
 *  persist vào legacy_reports. */
export async function parseAllReports(
  db: DB,
  companyId: string,
  dqhfRoot: string,
): Promise<ParseReportsResult> {
  const idx = buildCSharpIndex(dqhfRoot);

  // Gom report classes từ resolved.reports của mọi node.
  const nodes = await db
    .select({ resolved: legacyMenuMap.resolved })
    .from(legacyMenuMap)
    .where(and(eq(legacyMenuMap.companyId, companyId), isNotNull(legacyMenuMap.resolved)));
  const classes = new Set<string>();
  for (const n of nodes) {
    const reps = (n.resolved as { reports?: string[] } | null)?.reports ?? [];
    for (const r of reps) classes.add(r);
  }

  let parsed = 0;
  let table = 0;
  let document = 0;
  for (const cls of classes) {
    const bp = parseReport(idx, cls);
    if (bp.note) continue; // không thấy file → bỏ
    if (bp.kind === "table") table++;
    else document++;
    await db
      .insert(legacyReports)
      .values({
        companyId,
        reportClass: bp.reportClass,
        namespace: bp.namespace,
        title: bp.title,
        kind: bp.kind,
        dataProcs: bp.dataProcs,
        columns: bp.columns,
        groups: bp.groups,
        summaries: bp.summaries,
        hasBeforePrint: bp.hasBeforePrint,
      })
      .onConflictDoUpdate({
        target: [legacyReports.companyId, legacyReports.reportClass],
        set: {
          namespace: bp.namespace,
          title: bp.title,
          kind: bp.kind,
          dataProcs: bp.dataProcs,
          columns: bp.columns,
          groups: bp.groups,
          summaries: bp.summaries,
          hasBeforePrint: bp.hasBeforePrint,
          parsedAt: new Date(),
        },
      });
    parsed++;
  }
  return { totalReports: classes.size, parsed, table, document };
}
