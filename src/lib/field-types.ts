/* ==========================================================
   field-types.ts — Palette kiểu field cho EntityDesigner.
   Gộp kiểu builtin (mock-data) + field-type plugin đã đăng ký
   trong pluginRegistry. Plugin thêm kiểu field → tự hiện trong
   palette mà không sửa lõi.
   ========================================================== */
import { pluginRegistry } from "@erp-framework/core";
import { FIELD_TYPES, type FieldType } from "@/lib/mock-data";

/** Kiểu field cho designer = builtin + plugin (bỏ trùng theo id). */
export function getFieldTypes(): FieldType[] {
  const builtinIds = new Set(FIELD_TYPES.map((f) => f.id));
  const fromPlugins: FieldType[] = pluginRegistry.listFieldTypes()
    .filter((p) => !builtinIds.has(p.type))
    .map((p) => ({
      id: p.type,
      name: p.label,
      icon: (p.icon ?? "Wand") as FieldType["icon"],
      desc: p.description ?? "Kiểu field từ plugin",
    }));
  return [...FIELD_TYPES, ...fromPlugins];
}
