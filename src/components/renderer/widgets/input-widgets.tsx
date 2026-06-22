/* Leaf widget nhập (input) cho renderer: Search / Combobox / Listbox / Tagbox.
   Bind nguồn + đẩy/đọc pageState (lọc cha-con). Tách từ ConsumerPage.tsx
   (Phase A3) — chỉ di chuyển code, KHÔNG đổi hành vi. */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { I } from "@/components/Icons";
import { usePageState, useWidgetData } from "@/components/renderer/page-data";
import { SearchableSelect } from "@/components/ui";
import { TagBox } from "@/components/ui/tagbox";
import { useT } from "@/hooks/useT";
import { cn } from "@/lib/utils";

export function SearchWidget({ cfg }: { cfg: Record<string, unknown> }) {
  const pageState = usePageState();
  const stateKey = (cfg.stateKey as string) || "";
  const label = cfg.label as string | undefined;
  const placeholder = (cfg.placeholder as string) || "Tìm kiếm…";
  const val = (pageState.get(stateKey) as string) ?? "";

  if (!stateKey) return <div className="p-3 text-xs text-muted">Chưa cấu hình state key.</div>;

  return (
    <div className="p-2 h-full flex flex-col gap-1">
      {label && <div className="text-xs font-medium text-muted">{label}</div>}
      <div className="relative">
        <I.Search
          size={13}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
        />
        <input
          type="text"
          value={val}
          onChange={(e) => pageState.set(stateKey, e.target.value)}
          placeholder={placeholder}
          className="w-full h-8 pl-8 pr-7 border border-border rounded bg-bg text-sm outline-none focus:border-accent"
        />
        {val && (
          <button
            type="button"
            onClick={() => pageState.set(stateKey, "")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
          >
            <I.X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

export function ComboboxWidget({ cfg }: { cfg: Record<string, unknown> }) {
  const pageState = usePageState();
  const field = cfg.field as string | undefined;
  /** Field phụ hiển thị kèm trong nhãn: "${field} — ${labelField}". */
  const labelField = cfg.labelField as string | undefined;
  const { rows } = useWidgetData(cfg);
  const stateKey = (cfg.stateKey as string) || "";
  const label = cfg.label as string | undefined;
  const staticOpts = (cfg.options as string) || "";
  const optionLabels = (cfg.optionLabels as Record<string, string> | undefined) ?? {};
  const multiSelect = !!(cfg.multiSelect as boolean);

  // single-select value
  const val = (pageState.get(stateKey) as string) ?? "";
  // multi-select values — đọc trực tiếp từ pageState (reactive)
  const vals = (multiSelect ? (pageState.get(stateKey) as string[]) : null) ?? [];

  const dynamicOpts = useMemo(() => {
    if (!field || !rows.length) return [];
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    for (const r of rows) {
      const v = String(r[field] ?? "");
      if (!v || seen.has(v)) continue;
      seen.add(v);
      const extra = labelField ? String(r[labelField] ?? "") : "";
      out.push({ value: v, label: extra ? `${v} — ${extra}` : v });
    }
    out.sort((a, b) => a.value.localeCompare(b.value));
    return out;
  }, [rows, field, labelField]);

  const options = staticOpts
    ? staticOpts
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((o) => ({ value: o, label: optionLabels[o] ?? o }))
    : dynamicOpts;

  // multi-select dropdown state (gọi hook unconditional)
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: open change tính pos
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setDropPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 200) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  if (!stateKey) return <div className="p-3 text-xs text-muted">Chưa cấu hình state key.</div>;

  if (multiSelect) {
    const filtered = query
      ? options.filter((o) =>
          (optionLabels[o.value] ?? o.label).toLowerCase().includes(query.toLowerCase()),
        )
      : options;
    const getCur = (): string[] =>
      Array.isArray(pageState.get(stateKey)) ? (pageState.get(stateKey) as string[]) : [];
    const toggle = (v: string) => {
      const cur = getCur();
      pageState.set(stateKey, cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
    };
    const selectFiltered = () => {
      const cur = new Set(getCur());
      for (const o of filtered) cur.add(o.value);
      pageState.set(stateKey, [...cur]);
    };
    const deselectFiltered = () => {
      const remove = new Set(filtered.map((o) => o.value));
      pageState.set(
        stateKey,
        getCur().filter((v) => !remove.has(v)),
      );
    };
    const allFilteredChecked = filtered.length > 0 && filtered.every((o) => vals.includes(o.value));
    const triggerLabel = vals.length === 0 ? "Tất cả" : `${vals.length} đã chọn`;
    return (
      <div className="p-2 h-full flex flex-col gap-1">
        {label && <div className="text-xs font-medium text-muted">{label}</div>}
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="input flex w-full items-center justify-between gap-2 text-left"
        >
          <span className={cn("truncate", vals.length === 0 && "text-muted")}>{triggerLabel}</span>
          <I.ChevronDown size={14} className="shrink-0 text-muted" />
        </button>
        {open &&
          dropPos &&
          createPortal(
            <div
              ref={panelRef}
              style={{
                position: "fixed",
                top: dropPos.top,
                left: dropPos.left,
                minWidth: dropPos.width,
              }}
              className="z-[1000] w-max max-w-[300px] rounded-md border border-border bg-panel shadow-lg"
            >
              <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
                <I.Search size={13} className="shrink-0 text-muted" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Tìm…"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted/60"
                />
                {vals.length > 0 && (
                  <button
                    type="button"
                    onClick={() => pageState.set(stateKey, [])}
                    className="shrink-0 text-xs text-muted hover:text-danger"
                  >
                    <I.X size={12} />
                  </button>
                )}
              </div>
              {filtered.length > 0 && (
                <div className="flex items-center gap-1 border-b border-border px-2 py-1">
                  <button
                    type="button"
                    onClick={allFilteredChecked ? deselectFiltered : selectFiltered}
                    className="px-1.5 h-5 rounded text-[11px] border border-border hover:bg-hover/40 text-muted hover:text-text"
                  >
                    {allFilteredChecked ? "Bỏ hết" : "Chọn hết"}
                  </button>
                  <span className="ml-auto text-[11px] text-muted/70">
                    {filtered.length}/{options.length}
                  </span>
                </div>
              )}
              <ul className="max-h-60 overflow-y-auto py-1">
                {filtered.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-muted italic">Không có kết quả</li>
                ) : (
                  filtered.map((o) => {
                    const lbl = optionLabels[o.value] ?? o.label;
                    const checked = vals.includes(o.value);
                    return (
                      <li key={o.value}>
                        <button
                          type="button"
                          onClick={() => toggle(o.value)}
                          className={cn(
                            "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-hover/40",
                            checked && "font-medium text-accent",
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-3.5 shrink-0 items-center justify-center rounded border",
                              checked ? "border-accent bg-accent" : "border-border",
                            )}
                          >
                            {checked && <I.Check size={10} className="text-white" />}
                          </span>
                          <span className="truncate">{lbl}</span>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>,
            document.body,
          )}
      </div>
    );
  }

  return (
    <div className="px-2 pt-4 pb-1.5 flex items-center">
      <div className="relative w-full">
        {label && (
          <span className="absolute -top-[9px] left-2 z-10 px-0.5 text-[10px] leading-none text-muted bg-bg pointer-events-none select-none">
            {label}
          </span>
        )}
        <SearchableSelect
          className="w-full"
          value={val}
          onChange={(v) => pageState.set(stateKey, v)}
          options={options}
          emptyOption="— tất cả —"
        />
      </div>
    </div>
  );
}

export function ListboxWidget({ cfg }: { cfg: Record<string, unknown> }) {
  const t = useT();
  const pageState = usePageState();
  const field = cfg.field as string | undefined;
  const { rows } = useWidgetData(cfg);
  const stateKey = (cfg.stateKey as string) || "";
  const label = cfg.label as string | undefined;
  const staticOpts = (cfg.options as string) || "";
  const multiSelect = cfg.multiSelect !== false;
  const raw = pageState.get(stateKey);
  const selected: string[] = Array.isArray(raw) ? (raw as string[]) : raw ? [String(raw)] : [];

  const dynamicOpts = useMemo(() => {
    if (!field || !rows.length) return [];
    return [...new Set(rows.map((r) => String(r[field] ?? "")).filter(Boolean))].sort();
  }, [rows, field]);

  const options = staticOpts
    ? staticOpts
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : dynamicOpts;

  if (!stateKey) return <div className="p-3 text-xs text-muted">Chưa cấu hình state key.</div>;

  const toggle = (opt: string) => {
    if (!multiSelect) {
      pageState.set(stateKey, selected[0] === opt ? "" : opt);
      return;
    }
    const next = selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt];
    pageState.set(stateKey, next);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {label && (
        <div className="px-3 py-1.5 border-b border-border text-xs font-medium text-muted shrink-0">
          {label}
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        <button
          type="button"
          onClick={() => pageState.set(stateKey, multiSelect ? [] : "")}
          className={`w-full text-left px-3 py-1.5 text-sm hover:bg-surface flex items-center gap-2 border-b border-border/40 ${selected.length === 0 ? "text-accent font-medium" : "text-muted"}`}
        >
          <I.Filter size={12} className="shrink-0" />
          Tất cả
        </button>
        {options.map((opt) => {
          const isSel = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-surface flex items-center gap-2 border-b border-border/30 ${isSel ? "text-accent" : ""}`}
            >
              {multiSelect ? (
                <span
                  className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center ${isSel ? "bg-accent border-accent" : "border-border"}`}
                >
                  {isSel && <I.Check size={9} className="text-white" />}
                </span>
              ) : (
                <span
                  className={`w-3 h-3 rounded-full border shrink-0 ${isSel ? "bg-accent border-accent" : "border-border"}`}
                />
              )}
              <span className="truncate">{opt}</span>
            </button>
          );
        })}
        {options.length === 0 && (
          <div className="p-3 text-xs text-muted/60 text-center">{t("widget.empty_data")}</div>
        )}
      </div>
    </div>
  );
}

export function TagboxWidget({ cfg }: { cfg: Record<string, unknown> }) {
  const pageState = usePageState();
  const field = cfg.field as string | undefined;
  const { rows } = useWidgetData(cfg);
  const stateKey = (cfg.stateKey as string) || "";
  const label = cfg.label as string | undefined;
  const staticOpts = (cfg.options as string) || "";
  const placeholder = (cfg.placeholder as string) || undefined;
  const raw = pageState.get(stateKey);
  const selected: string[] = Array.isArray(raw) ? (raw as string[]) : [];

  const dynamicOpts = useMemo(() => {
    if (!field || !rows.length) return [];
    return [...new Set(rows.map((r) => String(r[field] ?? "")).filter(Boolean))].sort();
  }, [rows, field]);

  const suggestions = staticOpts
    ? staticOpts
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : dynamicOpts;

  if (!stateKey) return <div className="p-3 text-xs text-muted">Chưa cấu hình state key.</div>;

  return (
    <div className="px-2 pt-4 pb-1.5 flex items-start">
      <div className="relative w-full">
        {label && (
          <span className="absolute -top-[9px] left-2 z-10 px-0.5 text-[10px] leading-none text-muted bg-bg pointer-events-none select-none">
            {label}
          </span>
        )}
        <TagBox
          value={selected}
          onChange={(next) => pageState.set(stateKey, next)}
          suggestions={suggestions}
          placeholder={placeholder}
          strict={suggestions.length > 0}
        />
      </div>
    </div>
  );
}
