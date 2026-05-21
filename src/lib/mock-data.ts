/* Mock data — entities/pages/workflows/agents/LLM profiles. */

import type { I as IconSet } from "@/components/Icons";

export type IconName = keyof typeof IconSet;

export interface FieldType {
  id: string; name: string; icon: IconName; desc: string;
}
export const FIELD_TYPES: FieldType[] = [
  { id: "text",        name: "Text",         icon: "Type",      desc: "Single line text" },
  { id: "longtext",    name: "Long text",    icon: "List",      desc: "Multi-line" },
  { id: "number",      name: "Number",       icon: "Hash",      desc: "Integer / decimal" },
  { id: "currency",    name: "Currency",     icon: "DollarSign", desc: "VND / USD" },
  { id: "date",        name: "Date",         icon: "Calendar",  desc: "Date only" },
  { id: "datetime",    name: "Datetime",     icon: "Clock",     desc: "Date + time" },
  { id: "bool",        name: "Boolean",      icon: "ToggleR",   desc: "Yes / No" },
  { id: "select",      name: "Select",       icon: "ChevronDown", desc: "Single choice" },
  { id: "multiselect", name: "Multi-select", icon: "CheckSq",   desc: "Many choices" },
  { id: "email",       name: "Email",        icon: "Mail",      desc: "Validated email" },
  { id: "phone",       name: "Phone",        icon: "Phone",     desc: "VN phone" },
  { id: "url",         name: "URL",          icon: "Link",      desc: "External link" },
  { id: "address",     name: "Address",      icon: "MapPin",    desc: "VN address" },
  { id: "file",        name: "File",         icon: "File",      desc: "Upload file" },
  { id: "image",       name: "Image",        icon: "Image",     desc: "Upload image" },
  { id: "lookup",      name: "Lookup",       icon: "Link",      desc: "Ref entity" },
  { id: "formula",     name: "Formula",      icon: "Wand",      desc: "Computed" },
  { id: "tag",         name: "Tag",          icon: "Tag",       desc: "Color tags" },
];

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

export interface OrderRow {
  id: string; customer: string; total: number; status: string; date: string;
}
export const ORDER_ROWS: OrderRow[] = [
  { id: "DH-0142", customer: "Công ty TNHH Minh Phúc",  total: 84_500_000,  status: "Chờ duyệt", date: "19/05/2026" },
  { id: "DH-0141", customer: "Cửa hàng Thiên Hương",     total: 12_300_000,  status: "Đã duyệt",  date: "19/05/2026" },
  { id: "DH-0140", customer: "Nguyễn Văn An",            total: 2_450_000,   status: "Đã giao",   date: "18/05/2026" },
  { id: "DH-0139", customer: "Trần Thị Bích",            total: 6_780_000,   status: "Đã giao",   date: "18/05/2026" },
  { id: "DH-0138", customer: "Công ty CP Sao Mai",       total: 145_200_000, status: "Chờ duyệt", date: "17/05/2026" },
  { id: "DH-0137", customer: "Lê Quang Huy",             total: 980_000,     status: "Huỷ",       date: "17/05/2026" },
  { id: "DH-0135", customer: "Vũ Tuấn Anh",              total: 4_700_000,   status: "Nháp",      date: "16/05/2026" },
];

export function formatVND(n: number): string {
  return n.toLocaleString("vi-VN") + " ₫";
}
