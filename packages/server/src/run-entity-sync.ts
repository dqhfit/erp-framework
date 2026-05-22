/* ==========================================================
   run-entity-sync.ts — Đồng bộ dữ liệu MCP → entity_records
   phía SERVER. Khác bản client (src/lib/mcp-sync.ts): chạy trong
   tiến trình server, được scheduler gọi theo cron, hoặc gọi
   thủ công qua entitySync.runNow.

   Quy trình: nạp cấu hình sync + entity → đọc binding "list"
   trong entity.meta.mcpBindings → gọi tool MCP → normalize rows
   → upsert vào entity_records theo pkField → ghi nhật ký.
   ========================================================== */
import { and, eq } from "drizzle-orm";
import { entitySyncs, entities, entityRecords } from "@erp-framework/db";
import type { DB } from "./db";
import { makeCallTool } from "./mcp-client";
import { normalizeRows, inferPkField } from "./normalize";
import { logActivity } from "./activity";

/* Shape tối thiểu của McpBindings (song song McpBindingsEditor client). */
interface BindingArg {
  kind: string;
  key: string;
  value?: unknown;
}
interface McpBinding {
  tool?: string;
  args?: BindingArg[];
}
interface EntityMeta {
  mcpBindings?: { list?: McpBinding };
}

export interface EntitySyncResult {
  status: "completed" | "error";
  created: number;
  updated: number;
  total: number;
  summary: string;
}

/** Chạy MỘT lượt đồng bộ theo id cấu hình. Luôn cập nhật trạng
   thái vào bảng entity_syncs (kể cả khi lỗi). */
export async function runEntitySync(
  db: DB,
  syncId: string,
): Promise<EntitySyncResult> {
  const [cfg] = await db.select().from(entitySyncs)
    .where(eq(entitySyncs.id, syncId));
  if (!cfg) throw new Error(`Cấu hình sync không tồn tại: ${syncId}`);

  let created = 0;
  let updated = 0;
  let total = 0;
  let status: "completed" | "error" = "completed";
  let summary = "";

  try {
    const [entity] = await db.select().from(entities)
      .where(and(eq(entities.id, cfg.entityId),
        eq(entities.companyId, cfg.companyId)));
    if (!entity) throw new Error("Entity không tồn tại hoặc khác công ty.");

    const meta = (entity.meta ?? {}) as EntityMeta;
    const list = meta.mcpBindings?.list;
    if (!list?.tool) {
      throw new Error("Entity chưa bind tool 'list' cho MCP — không thể đồng bộ.");
    }

    // Chỉ áp args kiểu literal (filter/limit…) — field/formula không
    // có ngữ cảnh ở chế độ list.
    const args: Record<string, unknown> = {};
    for (const a of list.args ?? []) {
      if (a.kind === "literal") args[a.key] = a.value;
    }

    const callTool = makeCallTool(db, cfg.companyId);
    const raw = await callTool(list.tool, args);
    const rows = normalizeRows(raw);
    total = rows.length;

    // Xác định field khoá: ưu tiên cấu hình, không thì tự suy luận.
    const keyset = new Set<string>();
    for (const r of rows) Object.keys(r).forEach((k) => keyset.add(k));
    const pkField = cfg.pkField || inferPkField([...keyset]);

    // Bản ghi hiện có — lập map theo khoá để quyết định thêm/cập nhật.
    const existing = await db.select({
      id: entityRecords.id, data: entityRecords.data,
    }).from(entityRecords).where(and(
      eq(entityRecords.entityId, cfg.entityId),
      eq(entityRecords.companyId, cfg.companyId)));
    const byKey = new Map<string, string>();
    for (const r of existing) {
      const k = (r.data as Record<string, unknown>)[pkField];
      if (k !== undefined && k !== null) byKey.set(String(k), r.id);
    }

    for (const row of rows) {
      const k = row[pkField];
      const existingId = k !== undefined && k !== null
        ? byKey.get(String(k))
        : undefined;
      if (existingId) {
        await db.update(entityRecords)
          .set({ data: row, updatedAt: new Date() })
          .where(eq(entityRecords.id, existingId));
        updated++;
      } else {
        await db.insert(entityRecords).values({
          companyId: cfg.companyId,
          entityId: cfg.entityId,
          data: row,
        });
        created++;
      }
    }
    summary = `Đồng bộ ${total} dòng — thêm ${created}, cập nhật ${updated}.`;
  } catch (e) {
    status = "error";
    summary = (e as Error).message;
  }

  await logActivity(db, {
    companyId: cfg.companyId,
    kind: "entity-sync",
    objectType: "entity",
    target: cfg.entityId,
    detail: `Đồng bộ MCP — ${status}: ${summary}`.slice(0, 480),
  });

  await db.update(entitySyncs).set({
    lastRun: new Date(),
    lastStatus: status,
    lastSummary: summary.slice(0, 2000),
    runCount: cfg.runCount + 1,
    updatedAt: new Date(),
  }).where(eq(entitySyncs.id, cfg.id));

  return { status, created, updated, total, summary };
}
