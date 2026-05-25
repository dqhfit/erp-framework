/* ==========================================================
   field-types.ts — Palette kiểu field cho EntityDesigner.
   Gộp kiểu builtin + field-type plugin đã đăng ký trong
   pluginRegistry. Plugin thêm kiểu field → tự hiện trong palette
   mà không sửa lõi.
   ========================================================== */
import type { I as IconSet } from "@/components/Icons";
import { pluginRegistry } from "@erp-framework/core";

type IconName = keyof typeof IconSet;

export interface FieldType {
  id: string;
  name: string;
  icon: IconName;
  desc: string;
}

/** Kiểu field builtin của framework. */
export const FIELD_TYPES: FieldType[] = [
  { id: "text", name: "Text", icon: "Type", desc: "Single line text" },
  { id: "longtext", name: "Long text", icon: "List", desc: "Multi-line" },
  { id: "number", name: "Number", icon: "Hash", desc: "Integer / decimal" },
  { id: "currency", name: "Currency", icon: "DollarSign", desc: "VND / USD" },
  { id: "date", name: "Date", icon: "Calendar", desc: "Date only" },
  { id: "datetime", name: "Datetime", icon: "Clock", desc: "Date + time" },
  { id: "bool", name: "Boolean", icon: "ToggleR", desc: "Yes / No" },
  { id: "select", name: "Select", icon: "ChevronDown", desc: "Single choice (inline)" },
  { id: "multiselect", name: "Multi-select", icon: "CheckSq", desc: "Many choices (inline)" },
  { id: "enum", name: "Enum", icon: "Tag", desc: "Ref enum (đa ngôn ngữ)" },
  { id: "multi-enum", name: "Multi-enum", icon: "Tag", desc: "Multi ref enum" },
  { id: "email", name: "Email", icon: "Mail", desc: "Validated email" },
  { id: "phone", name: "Phone", icon: "Phone", desc: "VN phone" },
  { id: "url", name: "URL", icon: "Link", desc: "External link" },
  { id: "address", name: "Address", icon: "MapPin", desc: "VN address" },
  { id: "file", name: "File", icon: "File", desc: "Upload file" },
  { id: "image", name: "Image", icon: "Image", desc: "Upload image" },
  { id: "lookup", name: "Lookup", icon: "Link", desc: "Ref 1 entity" },
  { id: "multi-lookup", name: "Multi-lookup", icon: "Link", desc: "Ref nhiều entity (M2M)" },
  { id: "formula", name: "Formula", icon: "Wand", desc: "Computed" },
  { id: "sequence", name: "Sequence", icon: "Hash", desc: "Auto-number (INV-001)" },
  { id: "rollup", name: "Rollup", icon: "BarChart", desc: "Aggregate từ entity con" },
  { id: "timeseries", name: "Time-series", icon: "Activity", desc: "Chuỗi giá trị theo thời gian" },
  { id: "tag", name: "Tag", icon: "Tag", desc: "Color tags" },
];

/** Kiểu field cho designer = builtin + plugin (bỏ trùng theo id). */
export function getFieldTypes(): FieldType[] {
  const builtinIds = new Set(FIELD_TYPES.map((f) => f.id));
  const fromPlugins: FieldType[] = pluginRegistry
    .listFieldTypes()
    .filter((p) => !builtinIds.has(p.type))
    .map((p) => ({
      id: p.type,
      name: p.label,
      icon: (p.icon ?? "Wand") as FieldType["icon"],
      desc: p.description ?? "Kiểu field từ plugin",
    }));
  return [...FIELD_TYPES, ...fromPlugins];
}
