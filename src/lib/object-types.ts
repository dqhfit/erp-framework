/* ==========================================================
   object-types.ts — Kiểu dữ liệu dùng chung cho các đối tượng
   low-code (entity / page / workflow / agent) ở tầng app.

   Trước đây là `mock-data.ts` — đổi tên cho khớp nội dung thật:
   file chỉ còn ĐỊNH NGHĨA KIỂU, không còn dữ liệu mock. Hàm
   `formatVND` đã tách sang `format.ts`; bảng kiểu field builtin
   (`FIELD_TYPES`) đã chuyển vào `field-types.ts`.
   ========================================================== */
import type { I as IconSet } from "@/components/Icons";

export type IconName = keyof typeof IconSet;

export interface EntityField {
  id: string;
  name: string;
  label: string;
  labelEn?: string;
  type: string;
  required?: boolean;
  options?: string[];
  ref?: string;
  /** Cho field type "formula" */
  formula?: string;
  /** Cho field type "enum" / "multi-enum" — id của enum object (xem /enums). */
  enumId?: string;
  /** Cho field type "lookup" / "multi-lookup" — hành vi khi record đích bị xoá. */
  onDelete?: "restrict" | "setnull" | "cascade";
  /** Full-text search index (search_tsv). */
  searchable?: boolean;
  /** Unique constraint per company+entity (server-enforce). */
  unique?: boolean;
  /** Field-level RBAC — role nào đọc/ghi được. */
  readableBy?: Array<"admin" | "editor" | "viewer">;
  writableBy?: Array<"admin" | "editor" | "viewer">;
  /** Cho field type "sequence". */
  sequencePrefix?: string;
  sequencePadding?: number;
}
export interface MockEntity {
  id: string;
  name: string;
  icon: IconName;
  mcp: string;
  fields: EntityField[];
  /** Mapping 5 op (list/get/create/update/delete) → MCP tool + args */
  mcpBindings?: import("@/components/designer/McpBindingsEditor").McpBindings;
  /** Override per-op sang native procedure: { list?: "proc_name", ... }.
   *  Khi set, server records.* dispatch sang procedure-runner thay vì native CRUD. */
  procBindings?: Partial<Record<"list" | "get" | "create" | "update" | "delete", string>>;
}

export interface MockPage {
  id: string;
  name: string;
  icon: IconName;
  updated: string;
  author: string;
}

export interface MockWorkflow {
  id: string;
  name: string;
  icon: IconName;
  status: "active" | "paused";
  runs: number;
}

export interface MockAgent {
  id: string;
  name: string;
  model: string;
  tools: number;
}
