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
import { type EntityFieldDef, type FilterOp, fieldCan, type Role } from "@erp-framework/core";
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

/** Entity đã resolve + cấp quyền agent + nạp field-def — dùng chung giữa
 *  `searchAgentRecords` (thực thi) và `planRecordFilters` (routing sinh filter). */
export interface AgentEntityInfo {
  id: string;
  /** Tên kỹ thuật (đúng hoa/thường như trong DB). */
  name: string;
  /** Nhãn hiển thị. */
  label: string;
  fields: EntityFieldDef[];
}

const VALID_FILTER_OPS: FilterOp[] = [
  "=",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
  "contains",
  "in",
  "is-not-true",
  "is-true",
];

/** Resolve entity cho agent: case-insensitive + company-scoped → cổng
 *  deny-by-default `meta.agentSearchable` → nạp field-def. NÉM lỗi có thông
 *  điệp rõ khi thiếu tên / entity vắng / chưa opt-in (đồng nhất tool
 *  `records_search`). Caller PHẢI kiểm RBAC role-gate ("view:entity") trước. */
export async function describeAgentEntity(
  db: DB,
  companyId: string,
  entityName: string,
): Promise<AgentEntityInfo> {
  const name = entityName.trim();
  if (!name) throw new Error("Thiếu tên entity.");
  const [ent] = await db
    .select()
    .from(entities)
    .where(and(eq(entities.companyId, companyId), sql`lower(${entities.name}) = lower(${name})`))
    .limit(1);
  if (!ent) {
    throw new Error(
      `Không tìm thấy entity "${name}" trong hệ thống. ` +
        `Hãy dùng đúng tên kỹ thuật của entity (phân biệt hoa/thường không quan trọng).`,
    );
  }
  // Deny-by-default: chỉ entity được bật cờ opt-in mới cho agent tra.
  const meta = (ent.meta ?? {}) as { agentSearchable?: boolean };
  if (meta.agentSearchable !== true) {
    throw new Error(
      `Entity "${name}" chưa được cấp quyền cho agent tìm kiếm. ` +
        `Admin cần bật "Cho phép agent tìm kiếm" (AgentSearchable) trong cài đặt entity.`,
    );
  }
  const fields = await loadEntityFields(db, companyId, ent.id);
  return { id: ent.id, name: ent.name, label: ent.label, fields };
}

/** Lọc-an-toàn bộ filter do LLM sinh (router/tool) TRƯỚC khi dựng WHERE.
 *  Hàm THUẦN — cổng RBAC field-level cho filter, chống rò rỉ qua "filter
 *  oracle" (lọc `>`/`<` trên field cấm để dò giá trị). Bỏ điều kiện nếu:
 *  field không tồn tại; role KHÔNG đọc được field (fieldCan read); field
 *  mã hoá (so sánh ciphertext vô nghĩa); hoặc op không hợp lệ. Rỗng →
 *  undefined (không thêm điều kiện nào). */
export function sanitizeAgentFilters(
  fields: EntityFieldDef[],
  filters: RecordListParams["filters"] | undefined,
  role: Role,
  groupIds: string[] = [],
  userId?: string,
): RecordListParams["filters"] | undefined {
  if (!filters || typeof filters !== "object") return undefined;
  const byName = new Map(fields.map((f) => [f.name, f]));
  const out: Record<string, { op: FilterOp; value: unknown }> = {};
  for (const [name, cond] of Object.entries(filters)) {
    const f = byName.get(name);
    if (!f) continue; // field lạ (LLM bịa / dò jsonb key) → bỏ
    if (f.encrypted) continue; // ciphertext → lọc vô nghĩa
    if (!fieldCan(role, "read", f, groupIds, userId)) continue; // RBAC: chống oracle
    if (!cond || typeof cond !== "object") continue;
    const op = (cond as { op?: unknown }).op as FilterOp;
    if (!VALID_FILTER_OPS.includes(op)) continue; // op không hỗ trợ → bỏ
    out[name] = { op, value: (cond as { value?: unknown }).value };
  }
  return Object.keys(out).length ? out : undefined;
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
  // Resolve + cổng deny-by-default + nạp field-def (helper dùng chung).
  const info = await describeAgentEntity(db, companyId, query.entity);
  const limit = Math.min(50, Math.max(1, query.limit ?? 10));
  // Cổng RBAC field-level cho filter (chống oracle) — áp cho MỌI đường vào
  // (tool autonomous lẫn routing). field cấm/lạ/mã-hoá/op-sai → bị bỏ.
  const filters = sanitizeAgentFilters(info.fields, query.filters, role);
  // Qua RecordStore — HYBRID-aware (entity tier='table' đọc bảng thật).
  const { rows } = await getRecordStore(db).list(companyId, info.id, {
    q: query.q,
    filters,
    limit,
    withTotal: false,
  });
  // Decrypt + field-level RBAC strip (đồng nhất records.get / records.export).
  return {
    entity: info.name,
    label: info.label,
    rows: rows.map((r) => ({
      id: r.id,
      data: stripUnreadableFields(
        info.fields,
        decryptDataOut(info.fields, r.data as Record<string, unknown>),
        role,
      ),
    })),
  };
}
