/* ==========================================================
   MasterFieldBinder — Cặp dropdown "Master" + "Field" dùng
   chung cho List/Chart/Kanban/Form... filter binding.
   Đầu ra: { field, stateKey } cho filterFromState/linkedToState.
   ========================================================== */
import { MasterPicker } from "@/components/designer/inspectors/MasterPicker";
import type { StateSource } from "@/lib/page-state-sources";

export interface MasterFieldValue {
  field: string;
  stateKey: string;
}

interface EntityField {
  name: string;
  label: string;
  type?: string;
}

interface Props {
  sources: StateSource[];
  /** Field danh sách của entity widget HIỆN TẠI để chọn field so sánh. */
  entityFields: EntityField[];
  value: MasterFieldValue | undefined;
  onChange: (next: MasterFieldValue | undefined) => void;
  /** Callback khi user pick source — caller cần auto-assign selectionStateKey
   *  cho List nguồn (giữ wiring hiện có). */
  onPickSource?: (src: StateSource | null) => void;
  /** Nhãn cho dropdown master, vd "Lọc theo", "Liên kết Master". */
  masterLabel?: string;
  fieldLabel?: string;
  showFieldPicker?: boolean;
}

export function MasterFieldBinder({
  sources,
  entityFields,
  value,
  onChange,
  onPickSource,
  masterLabel = "Master",
  fieldLabel = "Field liên kết",
  showFieldPicker = true,
}: Props) {
  return (
    <>
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-muted uppercase tracking-wide">
          {masterLabel}
        </label>
        <MasterPicker
          sources={sources}
          value={value?.stateKey ?? ""}
          onChange={({ stateKey, source }) => {
            onPickSource?.(source);
            if (!stateKey) {
              onChange(undefined);
            } else {
              onChange({ field: value?.field ?? "", stateKey });
            }
          }}
        />
      </div>
      {showFieldPicker && value?.stateKey && (
        <div className="space-y-1.5 mt-2">
          <label className="block text-xs font-semibold text-muted uppercase tracking-wide">
            {fieldLabel}
          </label>
          {entityFields.length > 0 ? (
            <select
              value={value.field}
              onChange={(e) => onChange({ field: e.target.value, stateKey: value.stateKey })}
              className="w-full h-8 px-2 border border-border rounded bg-bg text-sm outline-none focus:border-accent"
            >
              <option value="">— Chọn field —</option>
              {entityFields.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.label}
                  {f.type === "lookup" || f.type === "multi-lookup" ? " ↗" : ""}
                </option>
              ))}
            </select>
          ) : (
            <div className="text-[11px] text-muted italic px-1">
              Bind entity trước để chọn field
            </div>
          )}
        </div>
      )}
    </>
  );
}
