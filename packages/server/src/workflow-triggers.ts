/* ==========================================================
   workflow-triggers.ts — Kích hoạt workflow theo nguồn (cấp workflow,
   đọc workflows.triggerType + triggerConfig). Hiện phục vụ:
   - entity_changed: hook từ records-router (create/update/delete)
   - webhook:        tra workflow theo token (route /webhooks/workflow/:token)

   Cùng họ với triggerIotWorkflows (iot-shared.ts). Tất cả fire-and-forget
   ở caller: lỗi enqueue KHÔNG được vỡ thao tác gốc (ghi record / nhận POST).
   ========================================================== */
import { entities, workflows } from "@erp-framework/db";
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "./db";
import { enqueueWorkflowRun } from "./jobs";

export type EntityChangeKind = "create" | "update" | "delete";

interface EntityChangeEvent {
  companyId: string;
  entityId: string;
  /** Tên entity (cho payload). Bỏ trống → helper tự tra khi cần. */
  entityName?: string;
  event: EntityChangeKind;
  recordId: string;
  /** Dữ liệu record (đã giải mã). Bỏ trống = {}. */
  data?: Record<string, unknown>;
}

/** Quét workflow triggerType='entity_changed' của công ty, khớp filter
 *  (entityId + danh sách events) rồi enqueue. triggerConfig:
 *  `{ entityId?: string, events?: ("create"|"update"|"delete")[] }`.
 *  events rỗng/thiếu = mọi sự kiện. */
export async function triggerEntityWorkflows(db: DB, ev: EntityChangeEvent): Promise<void> {
  const list = await db
    .select()
    .from(workflows)
    .where(
      and(
        eq(workflows.companyId, ev.companyId),
        eq(workflows.triggerType, "entity_changed"),
        eq(workflows.isActive, true),
      ),
    );
  if (list.length === 0) return;

  // Tra tên entity một lần nếu caller không truyền (vd nhánh delete).
  let entityName = ev.entityName;
  if (!entityName) {
    const [e] = await db
      .select({ name: entities.name })
      .from(entities)
      .where(eq(entities.id, ev.entityId));
    entityName = e?.name ?? ev.entityId;
  }

  for (const wf of list) {
    const cfg = (wf.triggerConfig ?? {}) as {
      entityId?: string;
      events?: string[];
    };
    if (cfg.entityId && cfg.entityId !== ev.entityId) continue;
    if (Array.isArray(cfg.events) && cfg.events.length > 0 && !cfg.events.includes(ev.event)) {
      continue;
    }
    await enqueueWorkflowRun(wf.id, {
      entity: {
        entityId: ev.entityId,
        entityName,
        event: ev.event,
        recordId: ev.recordId,
        data: ev.data ?? {},
      },
    });
  }
}

/** Tra workflow webhook theo token (triggerConfig.token, secret duy nhất
 *  toàn cục). Không lộ companyId — token đã là bí mật. Null nếu không khớp
 *  hoặc workflow không active. */
export async function findWebhookWorkflow(db: DB, token: string): Promise<{ id: string } | null> {
  if (!token) return null;
  const [wf] = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(
      and(
        eq(workflows.triggerType, "webhook"),
        eq(workflows.isActive, true),
        sql`${workflows.triggerConfig} ->> 'token' = ${token}`,
      ),
    );
  return wf ?? null;
}
