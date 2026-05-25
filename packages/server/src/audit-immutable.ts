/* ==========================================================
   audit-immutable.ts — Write-only audit log.
   logAuditImmutable insert vào audit_log_immutable; trigger DB
   chặn UPDATE/DELETE → tamper-evident audit trail cho compliance.
   ========================================================== */
import { auditLogImmutable } from "@erp-framework/db";
import type { DB } from "./db";

export interface AuditImmutableInput {
  companyId?: string | null;
  kind: string;
  objectType?: string;
  target?: string;
  targetId?: string;
  actorUserId?: string;
  detail: string;
  diff?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

export async function logAuditImmutable(
  db: DB, e: AuditImmutableInput,
): Promise<void> {
  try {
    await db.insert(auditLogImmutable).values({
      companyId: e.companyId ?? null,
      kind: e.kind,
      objectType: e.objectType ?? null,
      target: e.target ?? null,
      targetId: e.targetId ?? null,
      actorUserId: e.actorUserId ?? null,
      detail: e.detail,
      diff: e.diff ?? null,
      ip: e.ip ?? null,
      userAgent: e.userAgent ?? null,
    });
  } catch (err) {
    // KHÁC với activity_log: audit immutable lỗi NGHIÊM TRỌNG → ngoài
    // console.error còn nên page admin. v1 chỉ log, v2 wire notification.
    console.error("[audit-immutable] CRITICAL ghi audit lỗi:",
      (err as Error).message);
  }
}
