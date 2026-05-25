import { I } from "@/components/Icons";
import { Button, Select } from "@/components/ui";
import { useDynamicModels } from "@/hooks/useDynamicModels";
import { useSettings } from "@/stores/settings";
import { inferAdapterFromModel } from "@erp-framework/core";
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

/* 6 adapter — gọi useDynamicModels cho từng cái để optgroup nào cũng
   có discovery list. claude/claude-pro/claude-cli cùng họ Claude
   (FALLBACK_MODELS giống nhau) nhưng KHÁC credential — giữ riêng
   group để user phân biệt route nào dùng. Cache 30 phút mỗi adapter. */
const KNOWN_ADAPTERS = [
  "claude",
  "claude-pro",
  "claude-cli",
  "openai",
  "gemini",
  "ollama",
] as const;
type KnownAdapter = (typeof KNOWN_ADAPTERS)[number];

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
  value,
  onChange,
  excludeModels,
  emptyOption,
  lockedAdapter,
  className,
  disabled,
  showRefresh = true,
}: ModelComboboxProps) {
  const llmProfiles = useSettings((s) => s.llmProfiles);
  const inferredAdapter = inferAdapterFromModel(value);
  const adapter = lockedAdapter ?? inferredAdapter;

  // Gọi hook cho 6 adapter — mỗi group có discovery riêng, không phụ
  // thuộc adapter của model hiện tại. Hook order ổn định nhờ
  // KNOWN_ADAPTERS là const tuple (luôn 6 lệnh hook theo thứ tự).
  const m = {
    claude: useDynamicModels("claude"),
    "claude-pro": useDynamicModels("claude-pro"),
    "claude-cli": useDynamicModels("claude-cli"),
    openai: useDynamicModels("openai"),
    gemini: useDynamicModels("gemini"),
    ollama: useDynamicModels("ollama"),
  } satisfies Record<KnownAdapter, ReturnType<typeof useDynamicModels>>;
  const discoveryByAdapter: Record<KnownAdapter, string[]> = {
    claude: m.claude.models,
    "claude-pro": m["claude-pro"].models,
    "claude-cli": m["claude-cli"].models,
    openai: m.openai.models,
    gemini: m.gemini.models,
    ollama: m.ollama.models,
  };
  const cur = (KNOWN_ADAPTERS as readonly string[]).includes(adapter)
    ? m[adapter as KnownAdapter]
    : null;
  const loading = cur?.loading ?? false;
  const source = cur?.source ?? null;
  const refresh = cur?.refresh ?? (() => Promise.resolve());

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
  }, [
    llmProfiles,
    m.claude.models,
    m["claude-pro"].models,
    m["claude-cli"].models,
    m.openai.models,
    m.gemini.models,
    m.ollama.models,
    lockedAdapter,
    excludeModels,
  ]);

  // Model đang dùng không có trong groups → hiển thị "custom" để giữ
  // tương thích với agent.config.model lưu tay từ trước.
  const allModels = useMemo(() => {
    const s = new Set<string>();
    for (const list of Object.values(groups)) for (const x of list) s.add(x.model);
    return s;
  }, [groups]);

  return (
    <div className={`flex gap-1 ${className ?? ""}`}>
      <Select
        value={value}
        disabled={disabled || (loading && allModels.size === 0)}
        onChange={(e) => onChange(e.target.value)}
      >
        {emptyOption !== undefined && <option value="">{emptyOption}</option>}
        {Object.entries(groups).map(([ad, list]) => (
          <optgroup key={ad} label={ad}>
            {list.map(({ model, from }) => (
              <option key={model} value={model}>
                {model}
                {from !== "discovery" ? ` — ${from}` : ""}
              </option>
            ))}
          </optgroup>
        ))}
        {value && !allModels.has(value) && <option value={value}>{value} (custom)</option>}
      </Select>
      {showRefresh && (
        <Button
          variant="ghost"
          size="sm"
          disabled={loading}
          title={`Refresh model list${source ? ` (nguồn hiện: ${source})` : ""}`}
          icon={loading ? <I.Loader size={12} className="animate-spin" /> : <I.Redo size={12} />}
          onClick={() => refresh()}
        />
      )}
    </div>
  );
}
