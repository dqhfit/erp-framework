/* ==========================================================
   mcp-binding-infer.ts — Suy luận binding cho 5 op MCP từ
   tool đã dùng để import schema.
   - list   = chính tool user đã chọn + args đã nhập
   - get    = tìm sibling tool có cùng prefix với pattern "*.get"
              hoặc "get_*", "find_*", "fetch_*", "show_*"
   - create = "*.create", "create_*", "new_*", "add_*"
   - update = "*.update", "update_*", "edit_*", "modify_*"
   - delete = "*.delete", "delete_*", "remove_*", "destroy_*"
   ========================================================== */

import type { McpArg, McpBindings, McpOp } from "@/components/designer/McpBindingsEditor";

const PATTERNS: Record<Exclude<McpOp, "list">, RegExp[]> = {
  get: [
    /\.get$/i,
    /^get[._-]/i,
    /^find[._-]/i,
    /^fetch[._-]/i,
    /^show[._-]/i,
    /\.find$/i,
    /\.show$/i,
    /\.read$/i,
    /\.detail$/i,
  ],
  create: [
    /\.create$/i,
    /^create[._-]/i,
    /^new[._-]/i,
    /^add[._-]/i,
    /\.insert$/i,
    /\.add$/i,
    /\.new$/i,
  ],
  update: [/\.update$/i, /^update[._-]/i, /^edit[._-]/i, /^modify[._-]/i, /\.edit$/i, /\.patch$/i],
  delete: [
    /\.delete$/i,
    /^delete[._-]/i,
    /^remove[._-]/i,
    /^destroy[._-]/i,
    /\.remove$/i,
    /\.destroy$/i,
  ],
};

/**
 * Trích "namespace" của 1 tool name. Ưu tiên dot-notation, fallback snake/kebab.
 *   "crm.customer.list"     → "crm.customer"
 *   "list_customers"        → "customers"
 *   "customer-list"         → "customer"
 *   "fetch_orders"          → "orders"
 */
export function getToolNamespace(toolName: string): string {
  // Dot-notation: bỏ phần cuối cùng
  if (toolName.includes(".")) {
    const parts = toolName.split(".");
    return parts.slice(0, -1).join(".");
  }
  // Snake/kebab — bỏ verb prefix nếu match
  const cleaned = toolName.replace(
    /^(list|get|create|new|add|update|edit|modify|delete|remove|find|fetch|show)[._-]/i,
    "",
  );
  // Hoặc bỏ verb suffix
  return cleaned.replace(/[._-](list|get|create|update|delete|find|fetch|show)$/i, "");
}

// Chuẩn hoá namespace để so sánh đỡ vướng plural/singular ("customers" ↔ "customer")
function normalizeNs(ns: string): string {
  return ns
    .toLowerCase()
    .replace(/ies$/, "y") // categories → category
    .replace(/s$/, ""); // customers → customer
}

/**
 * Tìm sibling tool match pattern + cùng namespace với `baseTool`.
 */
function findSibling(
  baseTool: string,
  availableTools: string[],
  patterns: RegExp[],
): string | undefined {
  const baseNs = normalizeNs(getToolNamespace(baseTool));
  // Loại bỏ chính baseTool
  const candidates = availableTools.filter((t) => t !== baseTool);

  for (const pat of patterns) {
    for (const t of candidates) {
      if (!pat.test(t)) continue;
      const ns = normalizeNs(getToolNamespace(t));
      if (ns === baseNs) return t;
    }
  }
  return undefined;
}

/**
 * Convert object args → McpArg[] dạng literal cho UI binding editor.
 */
function argsObjToList(args: Record<string, unknown>): McpArg[] {
  return Object.entries(args).map(([key, value]) => ({
    key,
    kind: "literal" as const,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
}

/**
 * Sinh bindings cho 5 op dựa trên tool user dùng + danh sách tool có sẵn.
 *
 * @param sourceTool - Tool user đã chọn để fetch sample
 * @param sourceArgs - Args đã gửi
 * @param availableTools - Toàn bộ tool MCP có sẵn
 * @param primaryKey - Tên field PK (default "id") — dùng cho get/update/delete args
 * @returns Bindings object cho 5 op, có op nào tìm thấy tool match thì có entry
 */
export function inferMcpBindings(
  sourceTool: string,
  sourceArgs: Record<string, unknown>,
  availableTools: string[],
  primaryKey = "id",
): McpBindings {
  const bindings: McpBindings = {};

  // list = chính tool đã chọn
  bindings.list = {
    tool: sourceTool,
    args: argsObjToList(sourceArgs),
  };

  // Các op khác — match sibling
  for (const op of ["get", "create", "update", "delete"] as const) {
    const matched = findSibling(sourceTool, availableTools, PATTERNS[op]);
    if (!matched) continue;

    const args: McpArg[] = [];
    if (op === "get" || op === "update" || op === "delete") {
      args.push({ key: primaryKey, kind: "field", value: primaryKey });
    }
    bindings[op] = { tool: matched, args };
  }

  return bindings;
}

/**
 * Đếm số op được bind tự động (cho thông báo UI).
 */
export function countBoundOps(bindings: McpBindings): number {
  return Object.values(bindings).filter((b) => b?.tool).length;
}
