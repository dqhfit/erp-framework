/* ==========================================================
   tools/index.ts — Bootstrap helpers cho tool system.
   Gọi ở packages/server/src/index.ts sau runMigrations và
   trước app.listen.
   ========================================================== */
import type { FastifyInstance } from "fastify";
import { toolRegistry } from "@erp-framework/core";
import type { DB } from "../db";
import { hydrateRegistryFromDb, scanTools } from "./scanner";
import { initToolsProxy } from "./proxy";
import { startTool, stopAllTools } from "./subprocess";

export { scanTools, registerRemoteTool } from "./scanner";
export { startTool, stopTool, stopAllTools, getRunningPort } from "./subprocess";
export { initToolsProxy } from "./proxy";
export { invokeCli } from "./cli-runner";
export { loadPluginTool } from "./plugin-loader";
export { parseAndMerge } from "./manifest-schema";

const DEFAULT_TOOLS_DIR = process.platform === "win32"
  ? "D:\\code\\cowok\\Tools"
  : "/code/cowok/Tools";

/** Toàn bộ chuỗi khởi tạo: hydrate DB → scan disk → mount proxy → auto-start. */
export async function bootstrapTools(
  app: FastifyInstance,
  db: DB,
): Promise<void> {
  const toolsDir = process.env.TOOLS_DIR ?? DEFAULT_TOOLS_DIR;
  try {
    await hydrateRegistryFromDb(db);
  } catch (e) {
    console.warn("[tools] hydrate DB lỗi (bảng có thể chưa migrate):",
      (e as Error).message);
    return;  // chưa migrate xong — bỏ qua, không vỡ boot
  }
  try {
    const res = await scanTools(db, { toolsDir });
    console.log(
      `[tools] scan ${toolsDir}: added=${res.added.length} updated=${res.updated.length} errors=${res.errors.length}`,
    );
  } catch (e) {
    console.warn(`[tools] scan ${toolsDir} lỗi:`, (e as Error).message);
  }
  try {
    await initToolsProxy(app, db);
  } catch (e) {
    console.warn("[tools] init proxy lỗi:", (e as Error).message);
  }
  // Auto-start spawn-runtime tools có override.spawn.autoStart=true.
  for (const t of toolRegistry.list()) {
    if (t.manifest.runtime !== "spawn") continue;
    if (!t.manifest.spawn?.autoStart) continue;
    startTool(t.manifest).catch((e) =>
      console.warn(`[tools] auto-start ${t.id} lỗi:`, (e as Error).message),
    );
  }
}

export async function shutdownTools(): Promise<void> {
  await stopAllTools();
}
