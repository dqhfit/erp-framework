/* ==========================================================
   scanner.ts — Quét thư mục TOOLS_DIR, tìm paperclip.manifest.json
   + sibling erp.tool.json, validate + upsert vào bảng `tools`,
   populate toolRegistry trong RAM. Idempotent theo slug.
   ========================================================== */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import fg from "fast-glob";
import { sql, eq } from "drizzle-orm";
import { tools as toolsTable } from "@erp-framework/db";
import { toolRegistry, type ToolSource, type ToolManifest } from "@erp-framework/core";
import type { DB } from "../db";
import { parseAndMerge } from "./manifest-schema";

export interface ScanOptions {
  toolsDir: string;
}

export interface ScanResult {
  added: string[];
  updated: string[];
  errors: Array<{ path: string; message: string }>;
  total: number;
}

async function readJsonSafe(path: string): Promise<unknown | undefined> {
  try {
    const buf = await readFile(path, "utf8");
    return JSON.parse(buf);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

/** Quét 1 lượt và upsert. Trả tóm tắt added/updated/errors. */
export async function scanTools(
  db: DB,
  opts: ScanOptions,
): Promise<ScanResult> {
  const result: ScanResult = { added: [], updated: [], errors: [], total: 0 };
  const dir = resolve(opts.toolsDir);
  // Bắt cả paperclip.manifest.json (chuẩn cũ) ở cả root tool/.
  const manifestPaths = await fg("*/paperclip.manifest.json", {
    cwd: dir,
    absolute: true,
    onlyFiles: true,
    deep: 2,
    suppressErrors: true,
  });
  result.total = manifestPaths.length;

  for (const manifestPath of manifestPaths) {
    try {
      const toolRoot = dirname(manifestPath);
      const overridePath = join(toolRoot, "erp.tool.json");
      const [rawJson, overrideJson] = await Promise.all([
        readJsonSafe(manifestPath),
        readJsonSafe(overridePath),
      ]);
      if (!rawJson) continue;

      const manifest: ToolManifest = parseAndMerge(rawJson, overrideJson);
      const source: ToolSource = {
        kind: "local",
        path: toolRoot,
        overridePath: overrideJson ? overridePath : undefined,
      };

      const upserted = await upsertTool(db, manifest, source);
      toolRegistry.register(manifest, source);
      if (upserted === "inserted") result.added.push(manifest.id);
      else result.updated.push(manifest.id);
    } catch (e) {
      const message = (e as Error).message;
      result.errors.push({ path: manifestPath, message });
      console.error(`[tools/scan] ${manifestPath}: ${message}`);
    }
  }
  return result;
}

/** Đăng ký 1 tool remote — chỉ nhận manifest từ URL (không có override). */
export async function registerRemoteTool(
  db: DB,
  manifestUrl: string,
  rawManifestJson: unknown,
): Promise<ToolManifest> {
  const manifest = parseAndMerge(rawManifestJson, { runtime: "remote" } as never);
  if (!manifest.remoteUrl) {
    // remoteUrl phải đến từ override hoặc derive từ URL gốc.
    manifest.remoteUrl = new URL(".", manifestUrl).toString();
  }
  const source: ToolSource = { kind: "remote", manifestUrl };
  await upsertTool(db, manifest, source);
  toolRegistry.register(manifest, source);
  return manifest;
}

async function upsertTool(
  db: DB,
  manifest: ToolManifest,
  source: ToolSource,
): Promise<"inserted" | "updated"> {
  const [existing] = await db.select({ id: toolsTable.id })
    .from(toolsTable).where(eq(toolsTable.slug, manifest.id)).limit(1);
  if (existing) {
    await db.update(toolsTable).set({
      name: manifest.name,
      displayName: manifest.displayName,
      kind: manifest.kind,
      runtime: manifest.runtime,
      manifest: manifest as unknown as Record<string, unknown>,
      source: source as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    }).where(eq(toolsTable.id, existing.id));
    return "updated";
  }
  await db.insert(toolsTable).values({
    slug: manifest.id,
    name: manifest.name,
    displayName: manifest.displayName,
    kind: manifest.kind,
    runtime: manifest.runtime,
    manifest: manifest as unknown as Record<string, unknown>,
    source: source as unknown as Record<string, unknown>,
    enabledGlobal: true,
  });
  return "inserted";
}

/** Hydrate registry từ DB (gọi 1 lần lúc boot, trước khi scan disk). */
export async function hydrateRegistryFromDb(db: DB): Promise<void> {
  const rows = await db.select().from(toolsTable);
  for (const row of rows) {
    const manifest = row.manifest as unknown as ToolManifest;
    const source = row.source as unknown as ToolSource;
    toolRegistry.register(manifest, source);
  }
}

// Dummy reference to silence unused import in some TS configs.
void sql;
