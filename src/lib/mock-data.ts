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

export const ENTITIES: MockEntity[] = [
  {
    id: "customer", name: "Khách hàng", icon: "Users", mcp: "crm.customer",
    fields: [
      { id: "f1", name: "code", label: "Mã KH", type: "text", required: true },
      { id: "f2", name: "name", label: "Tên khách hàng", type: "text", required: true },
      { id: "f3", name: "phone", label: "Số điện thoại", type: "phone" },
      { id: "f4", name: "email", label: "Email", type: "email" },
      { id: "f5", name: "segment", label: "Phân khúc", type: "select", options: ["VIP", "Doanh nghiệp", "Cá nhân"] },
      { id: "f6", name: "address", label: "Địa chỉ", type: "address" },
      { id: "f7", name: "created_at", label: "Ngày tạo", type: "datetime" },
    ],
  },
  {
    id: "order", name: "Đơn hàng", icon: "Cart", mcp: "sales.order",
    fields: [
      { id: "o1", name: "code", label: "Mã đơn", type: "text", required: true },
      { id: "o2", name: "customer_id", label: "Khách hàng", type: "lookup", ref: "customer", required: true },
      { id: "o3", name: "total", label: "Tổng tiền", type: "currency" },
      { id: "o4", name: "status", label: "Trạng thái", type: "select", options: ["Nháp", "Chờ duyệt", "Đã duyệt", "Đã giao", "Huỷ"] },
      { id: "o5", name: "order_date", label: "Ngày đặt", type: "date" },
    ],
  },
  { id: "product",   name: "Sản phẩm",  icon: "Package",   mcp: "inv.product",   fields: [] },
  { id: "employee",  name: "Nhân viên", icon: "Briefcase", mcp: "hr.employee",   fields: [] },
  { id: "invoice",   name: "Hoá đơn",   icon: "File",      mcp: "acc.invoice",   fields: [] },
  { id: "warehouse", name: "Kho hàng",  icon: "Warehouse", mcp: "inv.warehouse", fields: [] },
];

export interface MockPage {
  id: string; name: string; icon: IconName; updated: string; author: string;
}
export const PAGES: MockPage[] = [
  { id: "p_dashboard", name: "Bảng điều khiển kinh doanh", icon: "BarChart",  updated: "2 giờ trước",  author: "Anh Toàn" },
  { id: "p_orders",    name: "Quản lý đơn hàng",           icon: "Cart",      updated: "1 ngày trước", author: "Anh Toàn" },
  { id: "p_customers", name: "Danh sách khách hàng",       icon: "Users",     updated: "3 ngày trước", author: "Chị Linh" },
  { id: "p_inventory", name: "Kiểm kê kho",                icon: "Warehouse", updated: "1 tuần trước", author: "Anh Toàn" },
];

export interface MockWorkflow {
  id: string; name: string; icon: IconName; status: "active" | "paused"; runs: number;
}
export const WORKFLOWS: MockWorkflow[] = [
  { id: "w_approve_big_order", name: "Duyệt đơn hàng > 50tr",    icon: "Workflow", status: "active", runs: 142 },
  { id: "w_onboarding",        name: "Onboarding nhân viên mới", icon: "Workflow", status: "active", runs: 28 },
  { id: "w_low_stock",         name: "Cảnh báo tồn kho thấp",    icon: "Workflow", status: "paused", runs: 1204 },
];

export interface MockAgent {
  id: string; name: string; model: string; tools: number;
}
export const AGENTS: MockAgent[] = [
  { id: "a_sales",   name: "Trợ lý Sales",   model: "claude-haiku-4-5", tools: 8 },
  { id: "a_kho",     name: "Trợ lý Kho",     model: "gpt-4o-mini",      tools: 5 },
  { id: "a_finance", name: "Trợ lý Kế toán", model: "claude-sonnet-4",  tools: 12 },
];

export interface MockLLMProfile {
  id: string; name: string; adapter: string; model: string; hasKey: boolean; isDefault: boolean;
}
export const LLM_PROFILES: MockLLMProfile[] = [
  { id: "l1", name: "Anthropic - Sonnet 4",    adapter: "anthropic", model: "claude-sonnet-4",    hasKey: true,  isDefault: true  },
  { id: "l2", name: "Anthropic - Haiku 4.5",   adapter: "anthropic", model: "claude-haiku-4-5",   hasKey: true,  isDefault: false },
  { id: "l3", name: "OpenAI - GPT-4o mini",    adapter: "openai",    model: "gpt-4o-mini",        hasKey: true,  isDefault: false },
  { id: "l4", name: "OpenAI - o3",             adapter: "openai",    model: "o3",                 hasKey: false, isDefault: false },
  { id: "l5", name: "Google - Gemini 2.5",     adapter: "google",    model: "gemini-2.5-pro",     hasKey: false, isDefault: false },
  { id: "l6", name: "Local - llama3 (Ollama)", adapter: "ollama",    model: "llama3.1:8b",        hasKey: true,  isDefault: false },
];

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
