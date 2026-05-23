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

/* 4 adapter chính — gọi useDynamicModels cho từng adapter để optgroup
   nào cũng có discovery list, không phụ thuộc adapter hiện tại. Hook
   có cache 30 phút trong localStorage nên gọi 4 lần không tốn nhiều. */
const KNOWN_ADAPTERS = ["claude", "openai", "gemini", "ollama"] as const;

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

  // Gọi hook cho TỪNG adapter chính — mỗi group sau đó có discovery
  // riêng (không phụ thuộc adapter của model hiện tại). Hook order
  // ổn định nhờ KNOWN_ADAPTERS là const tuple.
  const claudeM = useDynamicModels("claude");
  const openaiM = useDynamicModels("openai");
  const geminiM = useDynamicModels("gemini");
  const ollamaM = useDynamicModels("ollama");
  const discoveryByAdapter: Record<string, string[]> = {
    claude: claudeM.models,
    openai: openaiM.models,
    gemini: geminiM.models,
    ollama: ollamaM.models,
  };
  const loading = adapter === "claude" ? claudeM.loading
    : adapter === "openai" ? openaiM.loading
    : adapter === "gemini" ? geminiM.loading
    : adapter === "ollama" ? ollamaM.loading : false;
  const source = adapter === "claude" ? claudeM.source
    : adapter === "openai" ? openaiM.source
    : adapter === "gemini" ? geminiM.source
    : adapter === "ollama" ? ollamaM.source : null;
  const refresh = adapter === "claude" ? claudeM.refresh
    : adapter === "openai" ? openaiM.refresh
    : adapter === "gemini" ? geminiM.refresh
    : adapter === "ollama" ? ollamaM.refresh : () => Promise.resolve();

  const groups = useMemo(() => {
    const out: Record<string, { model: string; from: string }[]> = {};
    const push = (ad: string, model: string, from: string) => {
      if (!model) return;
      if (lockedAdapter && ad !== lockedAdapter) return;
      const list = (out[ad] = out[ad] ?? []);
      if (!list.find((x) => x.model === model)) list.push({ model, from });
    };
    // 1. Model từ profile của user (mỗi profile 1 model).
    for (const p of Object.values(llmProfiles)) {
      push(p.adapter, p.model, `profile "${p.name}"`);
    }
    // 2. Discovery của mọi adapter chính — bảo đảm group nào cũng có
    //    danh sách đầy đủ, không chỉ adapter của model hiện tại.
    for (const ad of KNOWN_ADAPTERS) {
      for (const m of discoveryByAdapter[ad] ?? []) push(ad, m, "discovery");
    }
    // 3. Loại các model bị exclude (dùng cho fallback list).
    if (excludeModels?.length) {
      for (const ad of Object.keys(out)) {
        out[ad] = (out[ad] ?? []).filter((x) => !excludeModels.includes(x.model));
        if ((out[ad] ?? []).length === 0) delete out[ad];
      }
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llmProfiles, claudeM.models, openaiM.models, geminiM.models, ollamaM.models, lockedAdapter, excludeModels]);

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
