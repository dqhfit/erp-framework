/* ==========================================================
   manifest-schema.ts — Validate (zod) paperclip.manifest.json
   + erp.tool.json override, rồi merge thành ToolManifest.
   Core chứa TYPE thuần (no zod); validation kỹ ở đây.
   ========================================================== */
import { z } from "zod";
import {
  mergeManifest,
  type ErpToolOverride,
  type PaperclipManifestRaw,
  type ToolManifest,
} from "@erp-framework/core";

/** Khai báo I/O của paperclip — relaxed, passthrough field lạ. */
const ZIO = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean().optional(),
  mediaType: z.string().optional(),
  description: z.string().optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const ZAction = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputs: z.array(ZIO).optional(),
  outputs: z.array(ZIO).optional(),
}).passthrough();

/** paperclip.manifest.json — passthrough fields lạ để không vỡ khi
 *  paperclip thêm field mới. Chỉ validate fields bắt buộc + kiểu. */
export const ZPaperclipManifest = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  author: z.string().optional(),
  type: z.enum(["web-app", "mcp-server", "cli", "plugin"]),
  entry: z.string().min(1),
  runtime: z.string().optional(),
  inputs: z.array(ZIO).optional(),
  outputs: z.array(ZIO).optional(),
  actions: z.array(ZAction).optional(),
  integrations: z.record(z.string(), z.unknown()).optional(),
  permissions: z.array(z.string()).optional(),
  dependencies: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  icon: z.string().optional(),
}).passthrough();

/** erp.tool.json — lớp override do người triển khai ERP soạn. */
export const ZErpOverride = z.object({
  id: z.string().optional(),
  runtime: z.enum(["embedded", "spawn", "remote"]).optional(),
  enabled: z.boolean().optional(),
  remoteUrl: z.string().url().optional(),
  spawn: z.object({
    command: z.string(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    port: z.number().int().optional(),
    healthPath: z.string().optional(),
    autoStart: z.boolean().optional(),
  }).optional(),
  proxy: z.object({
    mountPath: z.string().optional(),
    forwardAuth: z.boolean().optional(),
  }).optional(),
  mcpConfigName: z.string().optional(),
  pluginEntry: z.string().optional(),
  permissions: z.array(z.string()).optional(),
}).passthrough();

export function parseAndMerge(
  rawJson: unknown,
  overrideJson?: unknown,
): ToolManifest {
  const raw = ZPaperclipManifest.parse(rawJson) as PaperclipManifestRaw;
  const override = overrideJson
    ? (ZErpOverride.parse(overrideJson) as ErpToolOverride)
    : undefined;
  return mergeManifest(raw, override);
}
