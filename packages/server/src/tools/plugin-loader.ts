/* ==========================================================
   plugin-loader.ts — Dynamic-import 1 file .js/.mjs từ tool
   kind="plugin" rồi feed vào pluginRegistry. Disable yêu cầu
   restart server (Node import cache không xoá sạch được).
   ========================================================== */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  pluginRegistry, type ToolManifest, type PluginModule,
} from "@erp-framework/core";

const loaded = new Set<string>();

export async function loadPluginTool(manifest: ToolManifest, toolRootPath: string): Promise<void> {
  if (manifest.kind !== "plugin") {
    throw new Error(`Tool "${manifest.id}" không phải kind=plugin`);
  }
  if (loaded.has(manifest.id)) return;

  const entry = manifest.pluginEntry ?? manifest.entry;
  const abs = resolve(toolRootPath, entry);
  const mod = await import(pathToFileURL(abs).href);
  const pluginModule: PluginModule | undefined =
    mod.default && mod.default.plugins ? mod.default
      : mod.plugins ? (mod as PluginModule)
      : undefined;
  if (!pluginModule) {
    throw new Error(
      `Tool plugin "${manifest.id}": entry không export PluginModule (cần default hoặc named có plugins[])`,
    );
  }
  pluginRegistry.register(pluginModule);
  loaded.add(manifest.id);
}
