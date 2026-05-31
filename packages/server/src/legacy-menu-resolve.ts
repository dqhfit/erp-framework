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

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { legacyMenuMap } from "@erp-framework/db";
import { type MssqlClient, analyzeProc } from "@erp-framework/mssql-client";
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
  const uowRe = /public\s+(?:static\s+)?\w+\s+(\w+)\s*=>\s*GetRepository<\s*(\w+)\s*>/g;
  for (const f of files) {
    if (!/^unitofwork\d*\.cs$/i.test(basename(f))) continue;
    const txt = readFileSync(f, "utf8");
    let m: RegExpExecArray | null;
    uowRe.lastIndex = 0;
    while ((m = uowRe.exec(txt))) uowMap.set(m[1]!.toLowerCase(), m[2]!);
  }

  return { fileByClass, uowMap, fileCount: files.length };
}

export interface ResolveFormResult {
  procs: string[];
  controls: string[];
  repos: string[];
  filesScanned: number;
  note?: string;
}

const PROC_RE = /MyQuery\(\s*"([^"]+)"/g;
// Bắt mọi `.<Prop>` (vd uow.DINHMUC_GOVAN, UnitOfWork.X, UnitOfWork2.X) rồi
// đối chiếu uowMap — không phụ thuộc tên biến/static.
const PROP_RE = /\.([A-Za-z_][A-Za-z0-9_]*)/g;
const NEW_RE = /new\s+([A-Za-z_]\w*)\s*\(/g;
/** Tên proc hợp lệ = 1 identifier (loại MyQuery chứa SQL thô như "SELECT ..."). */
const PROC_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Chỉ đệ quy vào lớp UI-control / data-layer (tránh nổ sang form khác).
const RECURSE_PATH =
  /[\\/](UserCtrl|CommonClass[\\/](BOL|DAL|MODELS))[\\/]|[\\/]DQHF\.Repository[\\/]/i;

/** Đệ quy form → control → BOL/repo, gom procs. */
export function resolveFormProcs(
  idx: CSharpIndex,
  winId: string,
  maxFiles = 400,
): ResolveFormResult {
  const start = idx.fileByClass.get(winId.toLowerCase());
  if (!start) {
    return { procs: [], controls: [], repos: [], filesScanned: 0, note: `Không thấy ${winId}.cs` };
  }
  const visited = new Set<string>();
  const procs = new Set<string>();
  const repos = new Set<string>();
  const controls = new Set<string>();
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

    let m: RegExpExecArray | null;
    PROC_RE.lastIndex = 0;
    while ((m = PROC_RE.exec(txt))) {
      const name = m[1]!;
      if (PROC_ID.test(name)) procs.add(name); // bỏ MyQuery chứa SQL thô
    }

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
      if (/^(xuc|uc|usc|xfm)/i.test(id) && idx.fileByClass.has(id.toLowerCase())) controls.add(id);
      enqueueClass(id);
    }
  }

  return {
    procs: [...procs].sort(),
    controls: [...controls].sort(),
    repos: [...repos].sort(),
    filesScanned: visited.size,
  };
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
