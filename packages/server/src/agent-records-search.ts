/* ==========================================================
   agent-records-search.ts — Truy DỮ LIỆU CÓ CẤU TRÚC cho agent.
   Tách từ tool `records_search` (index.ts) để DÙNG CHUNG giữa:
     - tool autonomous `records_search` (adapter native LLM tự gọi)
     - bước Query routing orchestrated (knowledge-agentic, mọi adapter)
   1 CỔNG BẢO MẬT DUY NHẤT: deny-by-default theo meta.agentSearchable +
   field-level RBAC strip. RBAC role-gate ("view:entity") do CALLER kiểm
   (fail-closed tại call-site, không tin vào việc tool đã được liệt kê).
   Xem docs/AGENTIC-RAG-DESIGN-2026-05-31.md §5 + §11.
   ========================================================== */
import type { Role } from "@erp-framework/core";
import { entities } from "@erp-framework/db";
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "./db";
import { getRecordStore, type RecordListParams } from "./record-store";
import { decryptDataOut, loadEntityFields, stripUnreadableFields } from "./router-helpers";

export interface AgentRecordHit {
  id: string;
  data: Record<string, unknown>;
}

export interface AgentRecordsResult {
  /** Tên kỹ thuật entity đã resolve (đúng hoa/thường như trong DB). */
  entity: string;
  /** Nhãn hiển thị — dùng để trích nguồn trong câu trả lời. */
  label: string;
  rows: AgentRecordHit[];
}

export interface AgentRecordsQuery {
  /** Tên kỹ thuật entity (resolve case-insensitive trong company). */
  entity: string;
  /** Từ khoá full-text trên field searchable. */
  q?: string;
  /** Lọc theo field: { field: { op, value } }. */
  filters?: RecordListParams["filters"];
  /** Số bản ghi (clamp 1..50, mặc định 10). */
  limit?: number;
}

/** Tra bản ghi CÓ CẤU TRÚC cho agent: resolve entity (case-insensitive,
 *  company-scoped) → cổng deny-by-default `meta.agentSearchable` → store.list
 *  (HYBRID-aware: entity tier='table' đọc bảng thật) → decrypt + field-level
 *  RBAC strip theo `role`. NÉM lỗi có thông điệp rõ khi entity không tồn tại
 *  hoặc chưa opt-in (đồng nhất với tool `records_search`). Caller PHẢI kiểm
 *  RBAC role-gate ("view:entity") TRƯỚC khi gọi. */
export async function searchAgentRecords(
  db: DB,
  companyId: string,
  role: Role,
  query: AgentRecordsQuery,
): Promise<AgentRecordsResult> {
  const entityName = query.entity.trim();
  if (!entityName) throw new Error("Thiếu tên entity.");
  // Resolve entity theo tên CASE-INSENSITIVE trong phạm vi công ty.
  const [ent] = await db
    .select()
    .from(entities)
    .where(
      and(eq(entities.companyId, companyId), sql`lower(${entities.name}) = lower(${entityName})`),
    )
    .limit(1);
  if (!ent) {
    throw new Error(
      `Không tìm thấy entity "${entityName}" trong hệ thống. ` +
        `Hãy dùng đúng tên kỹ thuật của entity (phân biệt hoa/thường không quan trọng).`,
    );
  }
  // Deny-by-default: chỉ entity được bật cờ opt-in mới cho agent tra.
  const meta = (ent.meta ?? {}) as { agentSearchable?: boolean };
  if (meta.agentSearchable !== true) {
    throw new Error(
      `Entity "${entityName}" chưa được cấp quyền cho agent tìm kiếm. ` +
        `Admin cần bật "Cho phép agent tìm kiếm" (AgentSearchable) trong cài đặt entity.`,
    );
  }
  const limit = Math.min(50, Math.max(1, query.limit ?? 10));
  // Qua RecordStore — HYBRID-aware (entity tier='table' đọc bảng thật).
  const { rows } = await getRecordStore(db).list(companyId, ent.id, {
    q: query.q,
    filters: query.filters,
    limit,
    withTotal: false,
  });
  // Decrypt + field-level RBAC strip (đồng nhất records.get / records.export).
  const fields = await loadEntityFields(db, companyId, ent.id);
  return {
    entity: ent.name,
    label: ent.label,
    rows: rows.map((r) => ({
      id: r.id,
      data: stripUnreadableFields(
        fields,
        decryptDataOut(fields, r.data as Record<string, unknown>),
        role,
      ),
    })),
  };
}
