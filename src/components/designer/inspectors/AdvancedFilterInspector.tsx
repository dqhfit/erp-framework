/* Bộ lọc nâng cao (AND/OR) standalone cho widget calendar/map/pivot/kpi (các
   widget chưa có MasterFieldBinder riêng). Hiện ở cuối inspector body, không gắn
   tab. Tách từ PageDesigner.tsx (Phase B4) — chỉ di chuyển code, KHÔNG đổi hành vi. */
import { FilterBuilder } from "@/components/designer/inspectors/FilterBuilder";
import type { PageComponent } from "@/components/designer/page-designer-constants";
import type { StateSource } from "@/lib/page-state-sources";
import { useUserObjects } from "@/stores/userObjects";
import type { FilterNode } from "@/types/page";

export function AdvancedFilterInspector({
  sel,
  update,
  stateSources,
  ensureMasterEmits,
}: {
  sel: PageComponent;
  update: (id: string, patch: Partial<PageComponent>) => void;
  stateSources: StateSource[];
  ensureMasterEmits: (source: StateSource | null) => void;
}) {
  const entities = useUserObjects((s) => s.entities);
  return (() => {
    const ent = entities.find((e) => e.id === (sel.config.entity as string | undefined));
    return (
      <details className="pt-2 border-t border-border">
        <summary className="text-xs font-semibold text-muted uppercase tracking-wide cursor-pointer hover:text-text">
          Bộ lọc nâng cao (AND / OR)
        </summary>
        <div className="mt-2">
          {!ent && (
            <div className="text-[11px] text-warning mb-2">
              Bind entity ở "Cấu hình" trước để chọn field filter.
            </div>
          )}
          <FilterBuilder
            value={sel.config.filters as FilterNode | null | undefined}
            onChange={(next) =>
              update(sel.id, {
                config: { ...sel.config, filters: next },
              })
            }
            sources={stateSources}
            entityFields={ent?.fields ?? []}
            onPickSource={ensureMasterEmits}
          />
        </div>
      </details>
    );
  })();
}
