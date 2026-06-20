/* Tab "Điều kiện" (Nguồn & Điều khiển) của inspector cho widget nhập
   (search/combobox/listbox/tagbox): state key, nhãn, placeholder, chọn nhiều,
   nguồn tuỳ chọn (entity+field hoặc tĩnh). Tách từ PageDesigner.tsx (Phase B4)
   — chỉ di chuyển code, KHÔNG đổi hành vi. */
import type { PageComponent } from "@/components/designer/page-designer-constants";
import { fieldBoth } from "@/components/FieldDisplayToggle";
import { FormField, Input, Select } from "@/components/ui";
import { useUserObjects } from "@/stores/userObjects";

export function DieukienInspector({
  sel,
  update,
}: {
  sel: PageComponent;
  update: (id: string, patch: Partial<PageComponent>) => void;
}) {
  const entities = useUserObjects((s) => s.entities);
  return (() => {
    const cfg2 = sel.config as {
      stateKey?: string;
      label?: string;
      placeholder?: string;
      entity?: string;
      field?: string;
      options?: string;
      multiSelect?: boolean;
    };
    const hasOptions = sel.kind !== "search";
    const optEnt = hasOptions ? entities.find((e) => e.id === cfg2.entity) : undefined;
    const upd = (patch: typeof cfg2) => update(sel.id, { config: { ...sel.config, ...patch } });
    return (
      <>
        <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mt-1">
          Điều khiển
        </div>
        <FormField label="State key">
          <Input
            placeholder="vd: search_q, filter_status"
            value={cfg2.stateKey ?? ""}
            onChange={(e) => upd({ stateKey: e.target.value })}
          />
          <div className="text-[10px] text-muted/70 mt-0.5 px-0.5">
            Widget khác đọc state key này để lọc dữ liệu
          </div>
        </FormField>
        <FormField label="Nhãn hiển thị">
          <Input
            placeholder="Để trống = không hiện nhãn"
            value={cfg2.label ?? ""}
            onChange={(e) => upd({ label: e.target.value })}
          />
        </FormField>
        {(sel.kind === "search" || sel.kind === "tagbox") && (
          <FormField label="Placeholder">
            <Input
              placeholder="Gợi ý nhập..."
              value={cfg2.placeholder ?? ""}
              onChange={(e) => upd({ placeholder: e.target.value })}
            />
          </FormField>
        )}
        {(sel.kind === "combobox" || sel.kind === "listbox") && (
          <FormField label="Chọn nhiều">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={sel.kind === "listbox" ? cfg2.multiSelect !== false : !!cfg2.multiSelect}
                onChange={(e) => upd({ multiSelect: e.target.checked })}
                className="accent-accent"
              />
              Cho phép chọn nhiều giá trị
            </label>
          </FormField>
        )}
        {hasOptions && (
          <>
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mt-1">
              Nguồn tuỳ chọn
            </div>
            <FormField label="Entity">
              <Select
                value={cfg2.entity ?? ""}
                onChange={(e) => upd({ entity: e.target.value, field: "" })}
              >
                <option value="">— tĩnh (nhập tay) —</option>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </Select>
            </FormField>
            {cfg2.entity && (
              <FormField label="Field lấy giá trị">
                <Select value={cfg2.field ?? ""} onChange={(e) => upd({ field: e.target.value })}>
                  <option value="">— chọn field —</option>
                  {(optEnt?.fields ?? []).map((f) => (
                    <option key={f.name} value={f.name}>
                      {fieldBoth(f)}
                    </option>
                  ))}
                </Select>
              </FormField>
            )}
            {!cfg2.entity && (
              <FormField label="Tuỳ chọn tĩnh (phân cách phẩy)">
                <Input
                  placeholder="Vd: Đang xử lý, Hoàn thành, Huỷ"
                  value={cfg2.options ?? ""}
                  onChange={(e) => upd({ options: e.target.value })}
                />
              </FormField>
            )}
          </>
        )}
      </>
    );
  })();
}
