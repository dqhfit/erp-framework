/* ==========================================================
   repo-paths.ts — Định vị gốc monorepo + thư mục plugins.

   `packages/plugins/` là workspace package ở GỐC repo. Code migration
   trước đây resolve nó bằng `process.cwd()/packages/plugins` — đúng khi
   server chạy với cwd=gốc repo (Docker), nhưng SAI ở local-dev (cwd=
   packages/server) → ghi nhầm vào packages/server/packages/plugins/.
   Đi ngược từ cwd tìm `pnpm-workspace.yaml` để lấy gốc repo chuẩn cho
   mọi môi trường.
   ========================================================== */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

let cached: string | null = null;

/** Gốc monorepo — thư mục chứa pnpm-workspace.yaml (đi ngược từ cwd).
 *  Fallback về process.cwd() nếu không tìm thấy (an toàn, không ném). */
export function repoRoot(): string {
  if (cached) return cached;
  let dir = process.cwd();
  for (;;) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) {
      cached = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      cached = process.cwd(); // chạm root filesystem — fallback
      return cached;
    }
    dir = parent;
  }
}

/** Thư mục plugins gốc repo: <root>/packages/plugins */
export function pluginsRoot(): string {
  return resolve(repoRoot(), "packages", "plugins");
}

/** Thư mục Tier D của 1 module: <root>/packages/plugins/module-<m> */
export function pluginModuleDir(module: string): string {
  return resolve(pluginsRoot(), `module-${module}`);
}
