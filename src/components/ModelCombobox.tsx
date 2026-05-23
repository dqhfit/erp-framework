/* ==========================================================
   ModelCombobox — 1 combobox xổ xuống chọn model LLM, items
   group theo adapter (<optgroup>). Gộp nguồn từ:
   - useSettings.llmProfiles (model thực sự đã setup, kèm tên
     profile làm gợi ý).
   - useDynamicModels(adapter) cho discovery list của adapter
     suy ra từ model hiện tại.
   Adapter là implicit — chọn model nào → server suy adapter.
   Component tái sử dụng ở agents.$id.tsx (primary + fallback)
   và LlmProfileCard.tsx.
   ========================================================== */
import { useMemo } from "react";
import { Button, Select } from "@/components/ui";
import { I } from "@/components/Icons";
import { useSettings } from "@/stores/settings";
import { useDynamicModels } from "@/hooks/useDynamicModels";
import { inferAdapterFromModel } from "@erp-framework/core";

export interface ModelComboboxProps {
  value: string;
  onChange: (model: string) => void;
  /** Bỏ qua model đã chọn ở chỗ khác (fallback list không chọn lại model chính). */
  excludeModels?: string[];
  /** Text option đầu tiên khi value="" — vd "+ Thêm model dự phòng…". */
  emptyOption?: string;
  /** Khoá adapter: chỉ hiện model của adapter này (LlmProfileCard). */
  lockedAdapter?: string;
  className?: string;
  disabled?: boolean;
  /** Hiện nút refresh discovery list. Mặc định true. */
  showRefresh?: boolean;
}

export function ModelCombobox({
  value, onChange, excludeModels, emptyOption,
  lockedAdapter, className, disabled, showRefresh = true,
}: ModelComboboxProps) {
  const llmProfiles = useSettings((s) => s.llmProfiles);
  const inferredAdapter = inferAdapterFromModel(value);
  const adapter = lockedAdapter ?? inferredAdapter;
  const {
    models: discovery, loading, source, refresh,
  } = useDynamicModels(adapter);

  const groups = useMemo(() => {
    const out: Record<string, { model: string; from: string }[]> = {};
    const push = (ad: string, model: string, from: string) => {
      if (!model) return;
      if (lockedAdapter && ad !== lockedAdapter) return;
      const list = (out[ad] = out[ad] ?? []);
      if (!list.find((x) => x.model === model)) list.push({ model, from });
    };
    for (const p of Object.values(llmProfiles)) {
      push(p.adapter, p.model, `profile "${p.name}"`);
    }
    for (const m of discovery) push(adapter, m, "discovery");
    // Loại các model bị exclude.
    if (excludeModels?.length) {
      for (const ad of Object.keys(out)) {
        out[ad] = (out[ad] ?? []).filter((x) => !excludeModels.includes(x.model));
        if ((out[ad] ?? []).length === 0) delete out[ad];
      }
    }
    return out;
  }, [llmProfiles, discovery, adapter, lockedAdapter, excludeModels]);

  // Model đang dùng không có trong groups → hiển thị "custom" để giữ
  // tương thích với agent.config.model lưu tay từ trước.
  const allModels = useMemo(() => {
    const s = new Set<string>();
    for (const list of Object.values(groups)) for (const x of list) s.add(x.model);
    return s;
  }, [groups]);

  return (
    <div className={"flex gap-1 " + (className ?? "")}>
      <Select
        value={value}
        disabled={disabled || (loading && allModels.size === 0)}
        onChange={(e) => onChange(e.target.value)}
      >
        {emptyOption !== undefined && (
          <option value="">{emptyOption}</option>
        )}
        {Object.entries(groups).map(([ad, list]) => (
          <optgroup key={ad} label={ad}>
            {list.map(({ model, from }) => (
              <option key={model} value={model}>
                {model}{from !== "discovery" ? ` — ${from}` : ""}
              </option>
            ))}
          </optgroup>
        ))}
        {value && !allModels.has(value) && (
          <option value={value}>{value} (custom)</option>
        )}
      </Select>
      {showRefresh && (
        <Button
          variant="ghost" size="sm" disabled={loading}
          title={`Refresh model list${source ? ` (nguồn hiện: ${source})` : ""}`}
          icon={loading
            ? <I.Loader size={12} className="animate-spin" />
            : <I.Redo size={12} />}
          onClick={() => refresh()}
        />
      )}
    </div>
  );
}
