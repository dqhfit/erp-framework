/* Hằng số dùng chung cho PageDesigner: bảng palette component, tập loại widget
   theo nhóm (record-data / binding / input), toán tử load filter và bảng class
   màu cho action strip nhúng. Thuần (không React/UI). Tách từ PageDesigner.tsx
   (Phase B1). Bổ sung type lõi PageComponent + ActionBarItem (B2) để các module
   canvas/inspector tách ra dùng chung — KHÁC @/types/page (đừng gộp). */
import type { IconName } from "@/lib/object-types";
import type { ActionConfig } from "@/types/page";

export type ComponentKind =
  | "list"
  | "detail"
  | "form"
  | "chart"
  | "kpi"
  | "kanban"
  | "split"
  | "grid"
  | "search"
  | "combobox"
  | "listbox"
  | "tagbox"
  | "filter"
  | "calendar"
  | "map"
  | "pivot"
  | "html"
  | "action"
  | "actionbar"
  | "step"
  | "banve-type";

export type ActionBarItem = { id: string } & ActionConfig;

export interface PageComponent {
  id: string;
  kind: ComponentKind;
  x: number;
  y: number;
  w: number;
  h: number; // grid units
  config: Record<string, unknown>;
}

export const PALETTE: Array<{
  kind: ComponentKind;
  label: string;
  icon: IconName;
  defaultSize: { w: number; h: number };
}> = [
  { kind: "list", label: "List / Table", icon: "Table", defaultSize: { w: 12, h: 4 } },
  { kind: "detail", label: "Detail", icon: "PanelRight", defaultSize: { w: 6, h: 5 } },
  { kind: "form", label: "Form", icon: "Edit", defaultSize: { w: 6, h: 5 } },
  { kind: "chart", label: "Chart", icon: "BarChart", defaultSize: { w: 6, h: 3 } },
  { kind: "kpi", label: "KPI", icon: "TrendUp", defaultSize: { w: 3, h: 2 } },
  { kind: "kanban", label: "Kanban", icon: "Kanban", defaultSize: { w: 12, h: 4 } },
  { kind: "split", label: "Split Panel", icon: "Columns2", defaultSize: { w: 12, h: 5 } },
  { kind: "grid", label: "Grid Layout", icon: "LayoutGrid", defaultSize: { w: 12, h: 5 } },
  { kind: "filter", label: "Filter", icon: "Filter", defaultSize: { w: 12, h: 2 } },
  { kind: "search", label: "Search", icon: "Search", defaultSize: { w: 4, h: 2 } },
  { kind: "combobox", label: "Combobox", icon: "ChevronDown", defaultSize: { w: 3, h: 2 } },
  { kind: "listbox", label: "Listbox", icon: "List", defaultSize: { w: 3, h: 4 } },
  { kind: "tagbox", label: "Tagbox", icon: "Tag", defaultSize: { w: 4, h: 2 } },
  { kind: "html", label: "HTML / Note", icon: "Type", defaultSize: { w: 6, h: 2 } },
  { kind: "action", label: "Action", icon: "Play", defaultSize: { w: 3, h: 1 } },
  { kind: "actionbar", label: "Thanh hành động", icon: "Toolbar", defaultSize: { w: 12, h: 1 } },
  { kind: "step", label: "Wizard / Theo bước", icon: "Workflow", defaultSize: { w: 12, h: 6 } },
];

export const RECORD_DATA_KINDS = new Set([
  "list",
  "chart",
  "kanban",
  "calendar",
  "map",
  "pivot",
  "kpi",
  "combobox",
  "listbox",
  "tagbox",
]);
export const LOAD_OPS = ["=", "!=", ">", ">=", "<", "<=", "contains", "in"] as const;

/* Widget hỗ trợ chọn nguồn = entity HOẶC datasource (gồm cả detail/form). */
export const BINDING_KINDS = new Set([...RECORD_DATA_KINDS, "detail", "form"]);

/* Widget NHẬP (search/combobox/listbox/tagbox) — gắn nguồn + state ở tab
   "Nguồn & Điều khiển". Dùng để nhắc discoverability (badge canvas + nút
   chuyển tab trong inspector). */
export const INPUT_WIDGET_KINDS = new Set(["search", "combobox", "listbox", "tagbox"]);

/* Bảng class màu cho EmbeddedActionStrip (thanh hành động nhỏ trong header của
   list / form / detail preview). */
export const EMBED_PALETTE: Record<string, string> = {
  primary: "bg-accent/20 text-accent border-accent/40",
  danger: "bg-danger/10 text-danger border-danger/30",
  ghost: "bg-transparent text-muted border-transparent",
  default: "bg-panel-2 text-text border-border/60",
};
