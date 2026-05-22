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
  id: string; name: string; label: string; type: string;
  required?: boolean; options?: string[]; ref?: string;
  /** Cho field type "formula" */
  formula?: string;
}
export interface MockEntity {
  id: string; name: string; icon: IconName; mcp: string;
  fields: EntityField[];
  /** Mapping 5 op (list/get/create/update/delete) → MCP tool + args */
  mcpBindings?: import("@/components/designer/McpBindingsEditor").McpBindings;
}

export interface MockPage {
  id: string; name: string; icon: IconName; updated: string; author: string;
}

export interface MockWorkflow {
  id: string; name: string; icon: IconName; status: "active" | "paused"; runs: number;
}

export interface MockAgent {
  id: string; name: string; model: string; tools: number;
}
