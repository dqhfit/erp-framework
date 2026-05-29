/* ==========================================================
   module-procs.ts — Registry + lazy loader cho code Tier D
   (plugin TS) do migration codegen sinh ra.

   Codegen ghi file `packages/plugins/module-<m>/<name>.ts` export
   async function `(db, companyId, args) => Promise<result>`. Trước
   đây KHÔNG có cơ chế nào nạp tự động → file đứng yên, phải wire tay.
   Module này glob các thư mục module-*, import() động từng file (server
   chạy bằng tsx nên .ts load trực tiếp cả dev lẫn prod) rồi gom hàm vào
   registry để endpoint generic `migration.invokeModuleProc` gọi.

   Lazy + cache: nạp lần đầu khi có invoke, cache lại; `refreshModuleProcs()`
   nạp lại sau khi sinh thêm file mà không cần restart server.
   ========================================================== */
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DB } from "./db";
import { pluginsRoot } from "./repo-paths";

/** Chữ ký cố định của hàm Tier D do codegen sinh. */
export type ModuleProcFn = (
  db: DB,
  companyId: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export interface ModuleProcEntry {
  /** Tên module — phần sau "module-" của thư mục. */
  module: string;
  /** exportName của hàm (camelCase). */
  name: string;
  /** Đường dẫn file nguồn (relative repo root, slash). */
  file: string;
  fn: ModuleProcFn;
}

const registry = new Map<string, ModuleProcEntry>();
let loaded = false;
let loadingPromise: Promise<void> | null = null;
/** Tăng mỗi lần refresh để bust cache của import() khi file bị GHI ĐÈ
 *  (Node cache dynamic import theo URL; file mới-tên thì không cần). */
let cacheBust = 0;

// Gốc plugins theo repo root (không phải process.cwd) — xem repo-paths.ts.
const PLUGINS_ROOT = () => pluginsRoot();

export function moduleProcKey(module: string, name: string): string {
  return `${module}/${name}`;
}

/** Glob các thư mục module-* trong packages/plugins, import() động từng file
 *  .ts rồi gom export là hàm vào registry. */
async function loadAll(): Promise<void> {
  registry.clear();
  const root = PLUGINS_ROOT();
  if (!existsSync(root)) {
    loaded = true;
    return;
  }
  const moduleDirs = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("module-"))
    .map((d) => d.name);

  for (const dir of moduleDirs) {
    const module = dir.slice("module-".length);
    const dirPath = resolve(root, dir);
    const files = readdirSync(dirPath).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && !f.endsWith(".test.ts"),
    );
    for (const file of files) {
      const abs = resolve(dirPath, file);
      // pathToFileURL: bắt buộc trên Windows (import() cần file:// URL).
      const url = pathToFileURL(abs).href + (cacheBust ? `?v=${cacheBust}` : "");
      try {
        const mod = (await import(url)) as Record<string, unknown>;
        for (const [exportName, val] of Object.entries(mod)) {
          // Nhận async function chữ ký (db, companyId, args?) — arity >= 2.
          // (codegen luôn sinh 3 tham số; >=2 để dung sai khi args optional).
          if (typeof val === "function" && val.length >= 2) {
            registry.set(moduleProcKey(module, exportName), {
              module,
              name: exportName,
              file: `packages/plugins/${dir}/${file}`,
              fn: val as ModuleProcFn,
            });
          }
        }
      } catch (e) {
        // Một file lỗi (syntax/import) không được làm hỏng cả registry.
        console.warn(`[module-procs] import lỗi ${dir}/${file}:`, (e as Error).message);
      }
    }
  }
  loaded = true;
}

/** Nạp registry nếu chưa (lazy, idempotent, chống race khi nhiều invoke song song). */
export async function ensureModuleProcsLoaded(): Promise<void> {
  if (loaded) return;
  if (!loadingPromise) {
    loadingPromise = loadAll().finally(() => {
      loadingPromise = null;
    });
  }
  await loadingPromise;
}

/** Nạp lại từ đĩa — gọi sau khi codegen sinh/ghi đè file (không cần restart).
 *  Trả số entry sau khi nạp. */
export async function refreshModuleProcs(): Promise<number> {
  cacheBust++;
  loaded = false;
  await ensureModuleProcsLoaded();
  return registry.size;
}

export async function getModuleProc(
  module: string,
  name: string,
): Promise<ModuleProcEntry | undefined> {
  await ensureModuleProcsLoaded();
  return registry.get(moduleProcKey(module, name));
}

export async function listModuleProcs(): Promise<
  Array<Pick<ModuleProcEntry, "module" | "name" | "file">>
> {
  await ensureModuleProcsLoaded();
  return [...registry.values()].map(({ module, name, file }) => ({ module, name, file }));
}

/** Tra Tier D theo TÊN đơn (không kèm module) — match: full key "module/name",
 *  exportName, hoặc basename file (snake_case). Dùng cho fallback
 *  invokeProcedure khi workflow/records/proc-to-proc chỉ truyền 1 tên.
 *  Trùng tên ở nhiều module → lấy cái đầu + cảnh báo (gọi rõ qua
 *  invokeModuleProc(module,name) nếu cần phân biệt). */
export async function getModuleProcByName(name: string): Promise<ModuleProcEntry | undefined> {
  await ensureModuleProcsLoaded();
  const direct = registry.get(name); // dạng "module/exportName"
  if (direct) return direct;
  const fileBase = (e: ModuleProcEntry) => e.file.replace(/^.*\//, "").replace(/\.ts$/, "");
  const matches = [...registry.values()].filter((e) => e.name === name || fileBase(e) === name);
  if (matches.length === 0) return undefined;
  if (matches.length > 1) {
    console.warn(
      `[module-procs] tên "${name}" trùng ở ${matches.length} module: ${matches
        .map((m) => m.module)
        .join(", ")} — dùng "${matches[0]!.module}". Gọi rõ invokeModuleProc(module,name) nếu cần.`,
    );
  }
  return matches[0];
}
