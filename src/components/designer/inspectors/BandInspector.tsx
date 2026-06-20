/* Tab "Band" (nhóm cột) của inspector PageDesigner cho widget list: dựng cây
   columnGroups qua BandEditor, danh sách cột lấy từ entity/datasource. Tách từ
   PageDesigner.tsx (Phase B4) — chỉ di chuyển code, KHÔNG đổi hành vi. */

import { BandEditor } from "@/components/designer/inspectors/BandEditor";
import type { PageComponent } from "@/components/designer/page-designer-constants";
import { fieldBoth } from "@/components/FieldDisplayToggle";
import type { ColumnGroupNode } from "@/components/renderer/DataGrid";
import { useUserObjects } from "@/stores/userObjects";

export function BandInspector({
  sel,
  update,
}: {
  sel: PageComponent;
  update: (id: string, patch: Partial<PageComponent>) => void;
}) {
  const entities = useUserObjects((s) => s.entities);
  const dataSourceContent = useUserObjects((s) => s.dataSourceContent);
  return (() => {
    const dsId = sel.config.dataSourceId as string | undefined;
    const shown = sel.config.fields as string[] | null | undefined;
    const colLabels = sel.config.columnLabels as Record<string, string> | undefined;
    // Danh sách cột (field) widget hiện — nguồn entity hoặc datasource.
    let all: Array<{ name: string; label: string }> = [];
    if (dsId !== undefined) {
      const dsc = dataSourceContent[dsId];
      if (dsc) {
        all = [
          ...(dsc.fields ?? []).map((f) => ({
            name: f.key,
            label: fieldBoth({ name: f.key, label: f.label }),
          })),
          ...(dsc.aggregates ?? []).map((a) => ({
            name: a.key,
            label: fieldBoth({ name: a.key, label: a.label }),
          })),
          ...(dsc.computed ?? []).map((c) => ({
            name: c.key,
            label: fieldBoth({ name: c.key, label: c.label }),
          })),
        ];
      }
    } else {
      const ent = entities.find((e) => e.id === (sel.config.entity as string | undefined));
      all = (ent?.fields ?? []).map((f) => ({
        name: f.name,
        label: fieldBoth(f),
      }));
    }
    // Lọc theo cột đang hiển thị (null/undefined = tất cả) + áp nhãn override.
    // BandEditor inspector luôn hiện cả nhãn lẫn tên kỹ thuật (fieldBoth).
    const fields = (shown == null ? all : all.filter((f) => shown.includes(f.name))).map((f) => ({
      ...f,
      // colLabels override (nhãn cột tuỳ chỉnh): giữ dạng "nhãn (name)"
      label: colLabels?.[f.name] ? fieldBoth({ name: f.name, label: colLabels[f.name] }) : f.label,
    }));
    return (
      <BandEditor
        value={sel.config.columnGroups as ColumnGroupNode[] | undefined}
        availableFields={fields}
        onChange={(next) => update(sel.id, { config: { ...sel.config, columnGroups: next } })}
      />
    );
  })();
}
