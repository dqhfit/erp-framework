/* ==========================================================
   mcp-sync.ts — Đồng bộ dữ liệu từ MCP vào DB local (entity_records).
   Gọi tool "list" đã bind của entity → chuẩn hoá thành rows →
   upsert vào DB theo khóa (pkField): trùng khóa thì cập nhật,
   chưa có thì thêm mới. Chạy phía client (thủ công).
   ========================================================== */

import { createApiDataSource } from "@erp-framework/client";
import type { McpBindings } from "@/components/designer/McpBindingsEditor";
import { callMcpTool } from "@/hooks/useMcpClient";
import { normalizeRows } from "@/lib/schema-infer";

export interface SyncResult {
  created: number;
  updated: number;
  total: number;
}

/** Suy luận field khóa của entity để khớp bản ghi khi đồng bộ. */
export function inferPkField(fieldNames: string[]): string {
  return (
    fieldNames.find((n) => n === "id") ??
    fieldNames.find((n) => n === "code") ??
    fieldNames.find((n) => /(^|_)id$/i.test(n)) ??
    fieldNames[0] ??
    "id"
  );
}

/** Đồng bộ một entity từ MCP vào DB. Trả về số bản ghi thêm/cập nhật. */
export async function syncEntityFromMcp(
  entityId: string,
  bindings: McpBindings | undefined,
  pkField: string,
): Promise<SyncResult> {
  const list = bindings?.list;
  if (!list?.tool) {
    throw new Error("Entity chưa bind tool 'list' cho MCP — không thể đồng bộ.");
  }
  // Chỉ lấy args kiểu literal (filter/limit…); field/formula không áp cho list.
  const args: Record<string, unknown> = {};
  for (const a of list.args ?? []) {
    if (a.kind === "literal") args[a.key] = a.value;
  }

  const data = await callMcpTool(list.tool, args);
  const rows = normalizeRows(data) as Record<string, unknown>[];

  const ds = createApiDataSource("");
  const existing = await ds.getRecords(entityId);
  const byKey = new Map<string, string>();
  for (const r of existing.rows) {
    const k = r.data[pkField];
    if (k !== undefined && k !== null) byKey.set(String(k), r.id);
  }

  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const k = row[pkField];
    const existingId = k !== undefined && k !== null ? byKey.get(String(k)) : undefined;
    if (existingId) {
      await ds.updateRecord(existingId, row);
      updated++;
    } else {
      await ds.createRecord(entityId, row);
      created++;
    }
  }
  return { created, updated, total: rows.length };
}
