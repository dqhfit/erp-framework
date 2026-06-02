/* ==========================================================
   legacy-menu-resolve.ts — Resolver cockpit: 1 menu node (form C#)
   → tập stored proc + bảng MSSQL mà form đó đụng.

   Chuỗi thực tế DQHF: form (frmX) KHÔNG gọi proc trực tiếp mà nhúng
   UserControl (xuc*) → control gọi `UnitOfWork.<Repo>` + `MyQuery("PROC")`
   + `new <RepoClass>()`. Vậy resolver phải ĐỆ QUY: form → control → BOL/repo,
   gom mọi MyQuery + UnitOfWork ref, map UnitOfWork.<Prop> → RepoClass →
   proc của repo đó.

   Đọc source C# trên đĩa (host fs) — chạy nơi có D:\code\DotNET\DQHF
   (CLI/script local hoặc server có mount). Persist kết quả vào
   legacy_menu_map.resolved để cockpit dùng làm seed cho discover.
   ========================================================== */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  collectDirectProcs,
  collectScopedProcs,
  extractCallsInMethods,
  extractRepoMethodCalls,
  lastTypeSegment,
  SHARED_DATA_RE,
} from "@erp-framework/core";
import { legacyMenuMap } from "@erp-framework/db";
import { analyzeProc, type MssqlClient } from "@erp-framework/mssql-client";
import { and, eq, isNotNull } from "drizzle-orm";
import type { DB } from "./db";

/** Index source C#: tra file theo tên class + map UnitOfWork prop → repo class. */
export interface CSharpIndex {
  fileByClass: Map<string, string>; // lowerClassName -> absPath
  uowMap: Map<string, string>; // lowerProp -> RepoClassName
  fileCount: number;
}

const SKIP_DIRS = /^(obj|bin|node_modules|\.git|\.vs|packages|DQHFDotNet)$/i;

function walkCs(root: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.test(e.name)) continue;
      walkCs(join(root, e.name), out);
    } else if (e.isFile() && e.name.endsWith(".cs") && !e.name.endsWith(".Designer.cs")) {
      out.push(join(root, e.name));
    }
  }
}

/** Quét toàn bộ .cs dưới dqhfRoot → dựng fileByClass + uowMap. Tốn ~1s, cache. */
export function buildCSharpIndex(dqhfRoot: string): CSharpIndex {
  const files: string[] = [];
  walkCs(dqhfRoot, files);

  const fileByClass = new Map<string, string>();
  for (const f of files) {
    const cls = basename(f, ".cs").toLowerCase();
    if (!fileByClass.has(cls)) fileByClass.set(cls, f); // first wins
  }

  // UnitOfWork.cs: public static <Repo> <Prop> => GetRepository<<Repo>>()
  const uowMap = new Map<string, string>();
  // UnitOfWork (static) + UnitOfWork2 (instance) cùng pattern `=> GetRepository<X>`.
  // Type/generic cho phép namespace có dấu chấm (CommonClass.BOL.TR_X) — nếu chỉ
  // `\w+` thì các prop khai báo qua type đầy đủ bị BỎ SÓT khỏi uowMap.
  const uowRe =
    /public\s+(?:static\s+)?[\w.]+(?:<[^>]*>)?\s+(\w+)\s*=>\s*GetRepository<\s*([\w.]+)\s*>/g;
  for (const f of files) {
    if (!/^unitofwork\d*\.cs$/i.test(basename(f))) continue;
    const txt = readFileSync(f, "utf8");
    let m: RegExpExecArray | null;
    uowRe.lastIndex = 0;
    // Lưu segment cuối (CommonClass.BOL.TR_X → TR_X) để khớp fileByClass (basename).
    while ((m = uowRe.exec(txt))) uowMap.set(m[1]!.toLowerCase(), lastTypeSegment(m[2]!));
  }

  return { fileByClass, uowMap, fileCount: files.length };
}

export interface ResolveFormResult {
  procs: string[];
  controls: string[];
  reports: string[]; // class báo cáo (rpt*/Report_*) form mở/nhúng
  repos: string[];
  filesScanned: number;
  note?: string;
}

// Bắt mọi `.<Prop>` (vd uow.DINHMUC_GOVAN, UnitOfWork.X, UnitOfWork2.X) rồi
// đối chiếu uowMap — không phụ thuộc tên biến/static.
const PROP_RE = /\.([A-Za-z_][A-Za-z0-9_]*)/g;
const NEW_RE = /new\s+([A-Za-z_]\w*)\s*\(/g;
// Chỉ đệ quy vào UI-control / báo cáo / data-layer (tránh nổ sang form khác).
const RECURSE_PATH =
  /[\\/](UserCtrl|FormReport|CommonClass[\\/](BOL|DAL|MODELS))[\\/]|[\\/]DQHF\.Repository[\\/]/i;
/** Class báo cáo XtraReports: rpt_*, Report_*. */
const REPORT_ID = /^(rpt|report)/i;

/** Đệ quy form → control → BOL/repo, gom procs THEO MỨC METHOD.
 *
 *  Form/control (không phải data-layer dùng chung) → lấy MỌI MyQuery trực tiếp
 *  (chúng đặc thù 1 chức năng). Lớp data-layer dùng chung (CommonClass/BOL|DAL,
 *  DQHF.Repository) → CHỈ gom MyQuery trong thân method mà form/control thật sự
 *  gọi, tránh hốt cả proc của form khác dùng chung repo đó. */
export function resolveFormProcs(
  idx: CSharpIndex,
  winId: string,
  maxFiles = 400,
): ResolveFormResult {
  const start = idx.fileByClass.get(winId.toLowerCase());
  if (!start) {
    return {
      procs: [],
      controls: [],
      reports: [],
      repos: [],
      filesScanned: 0,
      note: `Không thấy ${winId}.cs`,
    };
  }
  const visited = new Set<string>();
  const repos = new Set<string>();
  const controls = new Set<string>();
  const reports = new Set<string>();
  // Văn bản các file form/control (không scope) vs file data-layer (scope theo method).
  const directTexts: string[] = [];
  const sharedFiles = new Map<string, string>(); // lowerClassName → text
  const queue: string[] = [start];

  const enqueueClass = (id: string): void => {
    const cf = idx.fileByClass.get(id.toLowerCase());
    if (cf && !visited.has(cf) && RECURSE_PATH.test(cf)) queue.push(cf);
  };

  while (queue.length && visited.size < maxFiles) {
    const f = queue.shift()!;
    if (visited.has(f)) continue;
    visited.add(f);
    let txt: string;
    try {
      txt = readFileSync(f, "utf8");
    } catch {
      continue;
    }

    if (SHARED_DATA_RE.test(f)) {
      sharedFiles.set(basename(f, ".cs").toLowerCase(), txt); // proc gom sau (scope).
    } else {
      directTexts.push(txt); // form/control: lấy mọi MyQuery trực tiếp.
    }

    let m: RegExpExecArray | null;
    PROP_RE.lastIndex = 0;
    while ((m = PROP_RE.exec(txt))) {
      const cls = idx.uowMap.get(m[1]!.toLowerCase());
      if (cls) {
        repos.add(cls);
        enqueueClass(cls); // nạp file repo để lấy MyQuery của nó
      }
    }

    // Control thường được khởi tạo trong .Designer.cs → gộp text designer để
    // bắt `new xuc*(` (vd frmDinhMucGoVan_TreeList). Designer không có proc.
    const designer = f.replace(/\.cs$/, ".Designer.cs");
    const newScanText = existsSync(designer) ? txt + "\n" + readFileSync(designer, "utf8") : txt;
    NEW_RE.lastIndex = 0;
    while ((m = NEW_RE.exec(newScanText))) {
      const id = m[1]!;
      const known = idx.fileByClass.has(id.toLowerCase());
      if (known && REPORT_ID.test(id)) reports.add(id);
      else if (known && /^(xuc|uc|usc|xfm)/i.test(id)) controls.add(id);
      enqueueClass(id);
    }
  }

  // ── Xác định method của từng repo mà form/control GỌI ──────────────────
  // Seed từ file form/control, rồi lan truyền qua thân method repo (repo gọi
  // repo khác) tới điểm bất động — để không sót proc transitive, cũng không
  // hốt method repo mà form không đụng.
  const procs = collectScopedProcsForForm(idx, directTexts, sharedFiles);

  return {
    procs: [...procs].sort(),
    controls: [...controls].sort(),
    reports: [...reports].sort(),
    repos: [...repos].sort(),
    filesScanned: visited.size,
  };
}

/** Tính tập proc cuối: MyQuery trực tiếp của form/control + MyQuery scope theo
 *  method được gọi trong các file data-layer dùng chung. */
function collectScopedProcsForForm(
  idx: CSharpIndex,
  directTexts: string[],
  sharedFiles: Map<string, string>,
): Set<string> {
  // called: lowerRepoClass → Set<methodName> mà form/control (và repo gọi repo) đụng.
  const called = new Map<string, Set<string>>();
  const addCall = (cls: string, method: string): boolean => {
    let s = called.get(cls);
    if (!s) {
      s = new Set();
      called.set(cls, s);
    }
    if (s.has(method)) return false;
    s.add(method);
    return true;
  };

  // Seed: lời gọi repo trong file form/control.
  for (const t of directTexts) {
    for (const c of extractRepoMethodCalls(t, idx.uowMap)) addCall(c.cls, c.method);
  }

  // Lan truyền tới điểm bất động: thân method repo đang-được-gọi có thể gọi
  // repo khác (repo→repo). Chỉ quét thân các method đã gọi, KHÔNG cả file.
  for (let guard = 0; guard < 50; guard++) {
    let changed = false;
    for (const [cls, text] of sharedFiles) {
      const methods = called.get(cls);
      if (!methods) continue;
      for (const c of extractCallsInMethods(text, [...methods], idx.uowMap)) {
        if (addCall(c.cls, c.method)) changed = true;
      }
    }
    if (!changed) break;
  }

  // Gom proc: form/control lấy hết; data-layer scope theo method được gọi.
  const procs = new Set<string>();
  for (const t of directTexts) {
    for (const p of collectDirectProcs(t)) procs.add(p);
  }
  for (const [cls, text] of sharedFiles) {
    for (const p of collectScopedProcs(text, called.get(cls))) procs.add(p);
  }
  return procs;
}

/** Loại "bảng" giả do analyzeProc bắt nhầm: cursor var, hàm split, temp. */
const NOISE_TABLE =
  /^(?:dbo\.)?(cur\d*|m_cursor|cursor\w*|fn_\w+|string_split|set|tmp\w*|#\w+|@\w+)$/i;

/** procs (tên stored proc) → tập bảng đọc/ghi qua MSSQL (analyzeProc). */
export async function resolveTablesForProcs(
  procs: string[],
  mssql: MssqlClient,
): Promise<{ tables: string[]; missing: string[] }> {
  const tables = new Set<string>();
  const missing: string[] = [];
  for (const p of procs) {
    const name = p.includes(".") ? p.split(".").pop()! : p;
    try {
      const proc = await mssql.getProc("dbo", name);
      if (!proc?.body) {
        missing.push(p);
        continue;
      }
      const a = analyzeProc(proc.body);
      for (const t of [...a.readsTables, ...a.writesTables]) {
        const q = t.includes(".") ? t.toLowerCase() : `dbo.${t.toLowerCase()}`;
        if (!NOISE_TABLE.test(q)) tables.add(q);
      }
    } catch {
      missing.push(p);
    }
  }
  return { tables: [...tables].sort(), missing };
}

/** Sinh tên module snake_case ASCII từ tên menu tiếng Việt (cho discover). */
export function slugifyModule(name: string | null, fallback: string): string {
  const base = (name ?? "").trim() || fallback;
  const ascii = base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // bỏ dấu tổ hợp (combining marks)
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
  let s = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
  if (!s || !/^[a-z]/.test(s)) s = `menu_${s}`.replace(/_+$/g, "");
  return s.slice(0, 48);
}

export interface ResolveAllResult {
  totalForms: number;
  resolved: number;
  withProcs: number;
  noForm: number;
}

/** Resolve C# cho MỌI node có winId, persist vào legacy_menu_map.resolved.
 *  KHÔNG đụng MSSQL (table-resolution để dành lúc port — tránh hammer DB). */
export async function resolveAllMenuNodes(
  db: DB,
  companyId: string,
  dqhfRoot: string,
): Promise<ResolveAllResult> {
  const idx = buildCSharpIndex(dqhfRoot);
  const nodes = await db
    .select({ id: legacyMenuMap.id, winId: legacyMenuMap.winId })
    .from(legacyMenuMap)
    .where(and(eq(legacyMenuMap.companyId, companyId), isNotNull(legacyMenuMap.winId)));

  let resolved = 0;
  let withProcs = 0;
  let noForm = 0;
  for (const n of nodes) {
    if (!n.winId) continue;
    const r = resolveFormProcs(idx, n.winId);
    if (r.note) noForm++;
    if (r.procs.length) withProcs++;
    await db
      .update(legacyMenuMap)
      .set({
        resolved: {
          procs: r.procs,
          controls: r.controls,
          reports: r.reports,
          repos: r.repos,
          filesScanned: r.filesScanned,
          ...(r.note ? { note: r.note } : {}),
        },
        resolvedAt: new Date(),
      })
      .where(eq(legacyMenuMap.id, n.id));
    resolved++;
  }
  return { totalForms: nodes.length, resolved, withProcs, noForm };
}
