/**
 * Browser-side port của legacy-menu-resolve.ts.
 * Phân tích source C# DQHF ngay trên client (File API) để suy ra
 * proc/control/repo cho từng form — không cần server đọc filesystem.
 *
 * Luồng: <input webkitdirectory> → buildDqhfIndex → resolveFormProcs → gửi lên server
 */

import {
  buildFieldTypeMap,
  collectDirectProcs,
  collectScopedProcs,
  extractCallsInMethods,
  extractRepoMethodCalls,
  lastTypeSegment,
  SHARED_DATA_RE,
} from "@erp-framework/core";

/** File đã quét: text + map field→repo class (để lần lời gọi uỷ quyền BOL→DAL). */
interface ScannedFile {
  text: string;
  fields: Map<string, string>;
}

export interface DqhfIndex {
  /** lowerClassName → nội dung file (đã merge Designer nếu có) */
  contentByClass: Map<string, string>;
  /** lowerClassName → webkitRelativePath (để kiểm tra RECURSE_PATH) */
  pathByClass: Map<string, string>;
  /** lowerUowProp → RepoClassName */
  uowMap: Map<string, string>;
  fileCount: number;
}

export interface DqhfResolveResult {
  procs: string[];
  controls: string[];
  reports: string[];
  repos: string[];
  filesScanned: number;
  note?: string;
}

// Giữ nguyên regex từ server-side legacy-menu-resolve.ts
const PROP_RE = /\.([A-Za-z_][A-Za-z0-9_]*)/g;
const NEW_RE = /new\s+([A-Za-z_]\w*)\s*\(/g;
const RECURSE_PATH =
  /[\\/](UserCtrl|FormReport|CommonClass[\\/](BOL|DAL|MODELS))[\\/]|[\\/]DQHF\.Repository[\\/]/i;
const REPORT_ID = /^(rpt|report)/i;
// Type/generic cho phép namespace có dấu chấm (CommonClass.BOL.TR_X) — khớp
// server (legacy-menu-resolve.ts), nếu chỉ `\w+` thì prop khai báo qua type
// đầy đủ bị bỏ sót khỏi uowMap.
const UOW_RE =
  /public\s+(?:static\s+)?[\w.]+(?:<[^>]*>)?\s+(\w+)\s*=>\s*GetRepository<\s*([\w.]+)\s*>/g;
const SKIP_DIRS = /[\\/](obj|bin|node_modules|\.git|\.vs|packages|DQHFDotNet)[\\/]/i;

/** Đọc tất cả .cs từ FileList, dựng index cho phân tích. */
export async function buildDqhfIndex(files: FileList): Promise<DqhfIndex> {
  const csFiles = Array.from(files).filter(
    (f) => f.name.endsWith(".cs") && !SKIP_DIRS.test(f.webkitRelativePath),
  );

  const read = await Promise.all(
    csFiles.map(async (f) => ({
      rel: f.webkitRelativePath,
      name: f.name,
      text: await f.text(),
    })),
  );

  const contentByClass = new Map<string, string>();
  const designerContent = new Map<string, string>();
  const pathByClass = new Map<string, string>();

  for (const { rel, name, text } of read) {
    if (name.endsWith(".Designer.cs")) {
      const cls = name.slice(0, -".Designer.cs".length).toLowerCase();
      designerContent.set(cls, text);
    } else {
      const cls = name.slice(0, -".cs".length).toLowerCase();
      if (!contentByClass.has(cls)) {
        contentByClass.set(cls, text);
        pathByClass.set(cls, rel);
      }
    }
  }

  // Merge Designer vào form chính để bắt `new xuc*(` trong Designer
  for (const [cls, dt] of designerContent) {
    const base = contentByClass.get(cls);
    if (base != null) contentByClass.set(cls, `${base}\n${dt}`);
  }

  // Build UnitOfWork property → RepoClass map
  const uowMap = new Map<string, string>();
  for (const [cls, text] of contentByClass) {
    if (!/^unitofwork\d*$/.test(cls)) continue;
    for (const m of text.matchAll(UOW_RE)) {
      // Segment cuối (CommonClass.BOL.TR_X → TR_X) để khớp contentByClass (basename).
      if (m[1] && m[2]) uowMap.set(m[1].toLowerCase(), lastTypeSegment(m[2]));
    }
  }

  return { contentByClass, pathByClass, uowMap, fileCount: csFiles.length };
}

/** Đệ quy form → control → BOL/repo, gom procs THEO MỨC METHOD. Logic giống
 *  server (legacy-menu-resolve.ts): form/control lấy mọi MyQuery trực tiếp; lớp
 *  data-layer dùng chung chỉ gom MyQuery trong thân method form/control GỌI —
 *  tránh hốt proc của form khác cùng dùng repo. */
export function resolveFormProcs(idx: DqhfIndex, winId: string, maxFiles = 400): DqhfResolveResult {
  const lc = winId.toLowerCase();
  if (!idx.contentByClass.has(lc)) {
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
  const directFiles: ScannedFile[] = []; // form/control: lấy mọi MyQuery
  const sharedFiles = new Map<string, ScannedFile>(); // lowerClass → file (scope theo method)
  const queue: string[] = [lc];

  const enqueue = (id: string): void => {
    const key = id.toLowerCase();
    if (!idx.contentByClass.has(key) || visited.has(key)) return;
    const path = idx.pathByClass.get(key) ?? "";
    if (RECURSE_PATH.test(path)) queue.push(key);
  };

  while (queue.length && visited.size < maxFiles) {
    const cls = queue.shift();
    if (!cls || visited.has(cls)) continue;
    visited.add(cls);
    const txt = idx.contentByClass.get(cls);
    if (!txt) continue;

    const path = idx.pathByClass.get(cls) ?? "";
    const scanned: ScannedFile = { text: txt, fields: buildFieldTypeMap(txt) };
    if (SHARED_DATA_RE.test(path)) sharedFiles.set(cls, scanned);
    else directFiles.push(scanned);

    for (const m of txt.matchAll(PROP_RE)) {
      if (!m[1]) continue;
      const repoClass = idx.uowMap.get(m[1].toLowerCase());
      if (repoClass) {
        repos.add(repoClass);
        enqueue(repoClass);
      }
    }

    for (const m of txt.matchAll(NEW_RE)) {
      const id = m[1];
      if (!id || !idx.contentByClass.has(id.toLowerCase())) continue;
      if (REPORT_ID.test(id)) reports.add(id);
      else if (/^(xuc|uc|usc|xfm)/i.test(id)) controls.add(id);
      enqueue(id);
    }
  }

  const procs = collectScopedProcsForForm(idx.uowMap, directFiles, sharedFiles);

  return {
    procs: [...procs].sort(),
    controls: [...controls].sort(),
    reports: [...reports].sort(),
    repos: [...repos].sort(),
    filesScanned: visited.size,
  };
}

/** Tính tập proc: MyQuery trực tiếp của form/control + MyQuery scope theo method
 *  được gọi trong các file data-layer dùng chung (lần cả uỷ quyền BOL→DAL qua field). */
function collectScopedProcsForForm(
  uowMap: Map<string, string>,
  directFiles: ScannedFile[],
  sharedFiles: Map<string, ScannedFile>,
): Set<string> {
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

  for (const f of directFiles) {
    for (const c of extractRepoMethodCalls(f.text, uowMap, f.fields)) addCall(c.cls, c.method);
  }

  for (let guard = 0; guard < 50; guard++) {
    let changed = false;
    for (const [cls, file] of sharedFiles) {
      const methods = called.get(cls);
      if (!methods) continue;
      for (const c of extractCallsInMethods(file.text, [...methods], uowMap, file.fields)) {
        if (addCall(c.cls, c.method)) changed = true;
      }
    }
    if (!changed) break;
  }

  const procs = new Set<string>();
  for (const f of directFiles) {
    for (const p of collectDirectProcs(f.text)) procs.add(p);
  }
  for (const [cls, file] of sharedFiles) {
    for (const p of collectScopedProcs(file.text, called.get(cls))) procs.add(p);
  }
  return procs;
}
