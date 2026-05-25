/* ==========================================================
   merge.ts — Hợp nhất PaperclipManifestRaw + ErpToolOverride
   thành ToolManifest chuẩn hoá. Pure — không I/O, không zod.
   Validation kỹ hơn nằm ở server/tools/manifest-schema.ts.
   ========================================================== */
import type {
  PaperclipManifestRaw, ErpToolOverride, ToolManifest, ToolRuntime,
} from "./types";

/** Suy ra runtime mặc định khi override không khai báo. */
function inferRuntime(raw: PaperclipManifestRaw): ToolRuntime {
  // Paperclip dùng "browser"/"node" — map sang ERP runtime.
  if (raw.runtime === "node") return "spawn";
  if (raw.runtime === "browser") return "embedded";
  // Theo kind
  switch (raw.type) {
    case "web-app":    return "embedded";
    case "mcp-server": return "spawn";
    case "cli":        return "spawn";
    case "plugin":     return "embedded"; // dynamic-import, không spawn
  }
}

/** Slug-hoá string — chỉ giữ a-z 0-9, dấu nối "-". */
export function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "tool";
}

export function mergeManifest(
  raw: PaperclipManifestRaw,
  override?: ErpToolOverride,
): ToolManifest {
  const id = slugify(override?.id ?? raw.name);
  const runtime: ToolRuntime = override?.runtime ?? inferRuntime(raw);

  // Đảm bảo override hợp lệ tối thiểu cho từng runtime.
  if (runtime === "remote" && !override?.remoteUrl) {
    throw new Error(`Tool "${id}": runtime=remote nhưng thiếu remoteUrl`);
  }
  if (runtime === "spawn" && raw.type === "web-app" && !override?.spawn) {
    throw new Error(
      `Tool "${id}": web-app+spawn nhưng thiếu spawn.command/args`,
    );
  }

  return {
    id,
    raw,
    name: raw.name,
    version: raw.version ?? "0.0.0",
    displayName: raw.displayName ?? raw.name,
    description: raw.description,
    category: raw.category,
    icon: raw.icon,
    kind: raw.type,
    runtime,
    entry: raw.entry,
    inputs: raw.inputs ?? [],
    outputs: raw.outputs ?? [],
    actions: raw.actions ?? [],
    permissions: override?.permissions ?? raw.permissions ?? [],
    tags: raw.tags ?? [],
    spawn: override?.spawn,
    proxy: {
      mountPath: override?.proxy?.mountPath ?? `/tools/${id}`,
      forwardAuth: override?.proxy?.forwardAuth ?? true,
    },
    remoteUrl: override?.remoteUrl,
    mcpConfigName: override?.mcpConfigName ?? (
      raw.type === "mcp-server" ? `tool:${id}` : undefined
    ),
    pluginEntry: override?.pluginEntry,
  };
}
