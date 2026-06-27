/* Cụm Filter cho renderer: FilterItem (1 combobox/tagbox/search có data-loading
   riêng) + MultiItemFilter (nhiều item, lọc cha-con + visibleWhen) + FilterWidget
   (dispatcher) + LegacyCascadeFilter (bộ lọc tầng cũ). Đẩy/đọc pageState. Tách
   từ ConsumerPage.tsx (Phase A4) — chỉ di chuyển code, KHÔNG đổi hành vi. */
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { I } from "@/components/Icons";
import { usePageState, useWidgetData } from "@/components/renderer/page-data";
import type { FItemCfg } from "@/components/renderer/page-types";
import { SearchableSelect } from "@/components/ui";
import { TagBox } from "@/components/ui/tagbox";
import { useDropdownPosition } from "@/hooks/useDropdownPosition";
import { cn } from "@/lib/utils";

/** Combobox ĐA CHỌN cho filter: dropdown checkbox + search, nhãn theo optionLabels,
 *  ghi string[] vào pageState (list lọc op "in"). */
function MultiCombo({
  stateKey,
  label,
  options,
  width,
  emptyLabel,
}: {
  stateKey: string;
  label: string;
  options: { value: string; label: string }[];
  width?: number;
  emptyLabel?: string;
}) {
  const pageState = usePageState();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pos = useDropdownPosition(triggerRef, open);

  const raw = pageState.get(stateKey);
  const selected: string[] = Array.isArray(raw) ? (raw as string[]) : [];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (!triggerRef.current?.contains(tgt) && !panelRef.current?.contains(tgt)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;
  const toggle = (v: string) =>
    pageState.set(
      stateKey,
      selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v],
    );

  const triggerLabel =
    selected.length === 0
      ? (emptyLabel ?? (label ? `${label}: tất cả` : "— tất cả —"))
      : `${label ? `${label}: ` : ""}${selected.length} đã chọn`;
  const wrapCls = width ? "shrink-0" : "shrink-0 min-w-[160px] max-w-[240px]";

  return (
    <div className={wrapCls} style={width ? { width } : undefined}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
        }}
        className="input flex w-full items-center justify-between gap-2 text-left"
      >
        <span className={cn("truncate", selected.length === 0 && "text-muted")}>
          {triggerLabel}
        </span>
        <I.ChevronDown size={14} className="shrink-0 text-muted" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              minWidth: Math.max(pos.width, 200),
            }}
            className="z-[1000] w-max max-w-[300px] rounded-md border border-border bg-panel shadow-lg"
          >
            <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
              <I.Search size={13} className="shrink-0 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tìm…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted/60"
              />
              {selected.length > 0 && (
                <button
                  type="button"
                  onClick={() => pageState.set(stateKey, [])}
                  className="shrink-0 text-xs text-muted hover:text-danger"
                  title="Bỏ chọn hết"
                >
                  <I.X size={12} />
                </button>
              )}
            </div>
            <ul className="max-h-60 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <li className="px-3 py-2 text-sm text-muted italic">Không có kết quả</li>
              ) : (
                filtered.map((o) => {
                  const checked = selected.includes(o.value);
                  return (
                    <li key={o.value}>
                      <button
                        type="button"
                        onClick={() => toggle(o.value)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-hover/40"
                      >
                        <span
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                            checked ? "bg-accent border-accent text-white" : "border-border",
                          )}
                        >
                          {checked && <I.Check size={11} />}
                        </span>
                        <span className="truncate">{o.label}</span>
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

/** Một thành phần lọc: combobox / tagbox / search với data loading riêng. */
function FilterItem({ item }: { item: FItemCfg }) {
  const pageState = usePageState();
  const { rows } = useWidgetData(item as Record<string, unknown>);
  const stateKey = item.stateKey || "";
  const label = item.label || "";

  // Seed giá trị chọn sẵn (defaultValue) 1 lần khi mount — chỉ khi state CHƯA có
  // (không ghi đè lựa chọn người dùng / giá trị đã khôi phục).
  const seededRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: chủ ý seed 1 lần khi mount
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (!stateKey || pageState.get(stateKey) !== undefined) return;
    // daterange: seed khoảng ngày mặc định (đầu→cuối tháng hiện tại) dạng cận ISO.
    if (item.kind === "daterange" && item.defaultRange === "currentMonth") {
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth();
      const pad = (n: number) => String(n).padStart(2, "0");
      const lastDay = new Date(y, m + 1, 0).getDate();
      pageState.set(stateKey, [
        `${y}-${pad(m + 1)}-01T00:00:00.000Z`,
        `${y}-${pad(m + 1)}-${pad(lastDay)}T23:59:59.999Z`,
      ]);
      return;
    }
    if (item.defaultValue !== undefined) {
      pageState.set(stateKey, item.defaultValue);
    }
  }, []);

  // Lọc liên kết (cross-filter): gộp phụ thuộc legacy (filterFromState/filterField)
  // + dependsOn[]. Options của item thu hẹp theo MỌI cha đang có giá trị (AND).
  const deps = useMemo(() => {
    const out: { fromState: string; field: string }[] = [];
    if (item.filterFromState && item.filterField)
      out.push({ fromState: item.filterFromState, field: item.filterField });
    for (const d of item.dependsOn ?? [])
      if (d.fromState && d.field) out.push({ fromState: d.fromState, field: d.field });
    return out;
  }, [item.filterFromState, item.filterField, item.dependsOn]);
  // Giá trị cha hiện tại (đọc pageState mỗi render) + chữ ký để memo + so sánh đổi.
  const depState = deps.map((d) => ({
    field: d.field,
    val: (pageState.get(d.fromState) as string) ?? "",
  }));
  const depSig = depState.map((d) => `${d.field}=${d.val}`).join("&");
  // biome-ignore lint/correctness/useExhaustiveDependencies: depSig đã gói depState (giá trị cha)
  const filteredRows = useMemo(() => {
    if (!deps.length) return rows;
    let out = rows;
    for (const { field, val } of depState) {
      if (field && val) out = out.filter((r) => String(r[field] ?? "") === val);
    }
    return out;
  }, [rows, depSig, deps.length]);

  const labelOptions = useMemo(() => {
    if (item.options) {
      const labels = item.optionLabels ?? {};
      return item.options
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((o) => ({ value: o, label: labels[o] ?? o }));
    }
    if (!item.field || !filteredRows.length) return [];
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    for (const r of filteredRows) {
      const v = String(r[item.field] ?? "");
      if (!v || seen.has(v)) continue;
      seen.add(v);
      const extra = item.labelField ? String(r[item.labelField] ?? "") : "";
      out.push({ value: v, label: extra ? `${v} — ${extra}` : v });
    }
    out.sort((a, b) => a.value.localeCompare(b.value));
    return out;
  }, [filteredRows, item.field, item.labelField, item.options, item.optionLabels]);

  const suggestions = labelOptions.map((o) => o.value);

  // Reset giá trị item khi BẤT KỲ filter cha nào đổi (đổi đơn hàng → xoá SP cũ).
  const prevDepSig = useRef(depSig);
  // biome-ignore lint/correctness/useExhaustiveDependencies: chủ ý chỉ react theo depSig
  useEffect(() => {
    if (deps.length && prevDepSig.current !== depSig && stateKey) {
      pageState.set(stateKey, "");
    }
    prevDepSig.current = depSig;
  }, [depSig]);

  if (!stateKey) return <div className="text-xs text-muted/60 italic px-1">Chưa có state key</div>;

  // width cố định khi có; mặc định shrink-0 (không flex-1 để không giãn fill row).
  const wrapStyle = item.width ? { width: item.width } : undefined;

  // Bọc control với label bên ngoài (bên trái) khi showLabel — opt-in.
  const withLabel = (control: ReactNode): ReactNode =>
    item.showLabel && label ? (
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-xs text-muted whitespace-nowrap">{label}</span>
        {control}
      </div>
    ) : (
      control
    );

  if (item.kind === "daterange") {
    // value state = [fromISO, toISO]. Input date "YYYY-MM-DD" → bọc thành cận ISO
    // (from = 00:00:00, to = 23:59:59) để so chuỗi với cột ngày lưu dạng ISO.
    const raw = pageState.get(stateKey);
    const range = Array.isArray(raw) ? (raw as string[]) : ["", ""];
    const fromDay = (range[0] ?? "").slice(0, 10);
    const toDay = (range[1] ?? "").slice(0, 10);
    const setRange = (from: string, to: string) => pageState.set(stateKey, [from, to]);
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-xs text-muted whitespace-nowrap">{item.label || "Khoảng ngày"}</span>
        <span className="text-xs text-muted">Từ</span>
        <input
          type="date"
          value={fromDay}
          onChange={(e) =>
            setRange(e.target.value ? `${e.target.value}T00:00:00.000Z` : "", range[1] ?? "")
          }
          className="input"
        />
        <span className="text-xs text-muted">Đến</span>
        <input
          type="date"
          value={toDay}
          onChange={(e) =>
            setRange(range[0] ?? "", e.target.value ? `${e.target.value}T23:59:59.999Z` : "")
          }
          className="input"
        />
        {(fromDay || toDay) && (
          <button
            type="button"
            onClick={() => setRange("", "")}
            className="shrink-0 text-muted hover:text-danger"
            title="Xóa khoảng ngày"
          >
            <I.X size={13} />
          </button>
        )}
      </div>
    );
  }

  if (item.kind === "combobox") {
    if (item.multiSelect) {
      return withLabel(
        <MultiCombo
          stateKey={stateKey}
          label={label}
          options={labelOptions}
          width={item.width}
          emptyLabel={item.emptyLabel}
        />,
      );
    }
    const val = (pageState.get(stateKey) as string) ?? "";
    const wrapCls = item.width ? "shrink-0" : "shrink-0 min-w-[160px] max-w-[240px]";
    return withLabel(
      <div className={wrapCls} style={wrapStyle}>
        <SearchableSelect
          className="w-full"
          value={val}
          onChange={(v) => pageState.set(stateKey, v)}
          options={labelOptions}
          placeholder={label || "Chọn…"}
          emptyOption={
            item.noEmpty
              ? undefined
              : (item.emptyLabel ?? (label ? `${label}: tất cả` : "— tất cả —"))
          }
          wrapOptions
        />
      </div>,
    );
  }

  if (item.kind === "tagbox") {
    const raw = pageState.get(stateKey);
    const selected: string[] = Array.isArray(raw) ? (raw as string[]) : [];
    const wrapCls = item.width ? "shrink-0" : "shrink-0 min-w-[180px] max-w-[320px]";
    return withLabel(
      <div className={wrapCls} style={wrapStyle}>
        <TagBox
          value={selected}
          onChange={(next) => pageState.set(stateKey, next)}
          suggestions={suggestions}
          strict={suggestions.length > 0}
          placeholder={item.placeholder || label || "Gõ để thêm…"}
          compact
        />
      </div>,
    );
  }

  // search
  const valS = (pageState.get(stateKey) as string) ?? "";
  const wrapCls = item.width ? "shrink-0" : "shrink-0 min-w-[160px] max-w-[280px]";
  return withLabel(
    <div className={wrapCls} style={wrapStyle}>
      <input
        type="text"
        value={valS}
        onChange={(e) => pageState.set(stateKey, e.target.value)}
        placeholder={item.placeholder || label || "Tìm…"}
        className="input w-full"
      />
    </div>,
  );
}

/** FilterWidget khi dùng items[] (format mới): hiện tất cả thành phần cùng lúc theo hàng. */
function MultiItemFilter({ cfg, items }: { cfg: Record<string, unknown>; items: FItemCfg[] }) {
  const pageState = usePageState();
  const refreshDsId = cfg.refreshDataSourceId as string | undefined;

  if (items.length === 0) return null;

  return (
    <div className="px-2 py-1.5 flex items-center gap-2 flex-wrap">
      {items.map((item) => {
        // visibleWhen: kiểm tra ở đây để tránh vi phạm hook-at-top-level trong FilterItem
        const vw = item.visibleWhen;
        if (vw) {
          const tabVal = (pageState.get(vw.stateKey) as string) ?? "";
          if (vw.oneOf && !vw.oneOf.includes(tabVal)) return null;
          if (vw.notOneOf && vw.notOneOf.includes(tabVal)) return null;
        }
        return <FilterItem key={item.id} item={item} />;
      })}
      {refreshDsId && (
        <button
          type="button"
          onClick={() => pageState.set(`__refresh:ds:${refreshDsId}`, Date.now())}
          className="shrink-0 self-center w-7 h-7 flex items-center justify-center rounded border border-border text-muted hover:text-text hover:bg-hover/50 transition-colors mt-1"
          title="Nạp lại"
        >
          <I.RefreshCw size={13} />
        </button>
      )}
    </div>
  );
}

/** Widget "filter" — dispatcher: items[] (mới) hoặc cascade legacy. */
export function FilterWidget({ cfg }: { cfg: Record<string, unknown> }) {
  const items = cfg.items as FItemCfg[] | undefined;
  return items ? <MultiItemFilter cfg={cfg} items={items} /> : <LegacyCascadeFilter cfg={cfg} />;
}

/** Legacy cascade filter: Hệ hàng → Sản phẩm + Nạp lại. */
function LegacyCascadeFilter({ cfg }: { cfg: Record<string, unknown> }) {
  const pageState = usePageState();
  const { rows, loading } = useWidgetData(cfg);
  const familyField = (cfg.familyField as string) || "hehang";
  const valueField = (cfg.valueField as string) || "masp";
  const labelField = (cfg.labelField as string) || "tensp";
  const emitStateKey = (cfg.emitStateKey as string) || "selMasp";
  const refreshDsId = cfg.refreshDataSourceId as string | undefined;
  const [hehang, setHehang] = useState("");
  const masp = (pageState.get(emitStateKey) as string) ?? "";

  const families = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      const v = r[familyField];
      if (v != null && v !== "") s.add(String(v));
    }
    return [...s].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));
  }, [rows, familyField]);

  const productOptions = useMemo(() => {
    const list = hehang ? rows.filter((r) => String(r[familyField] ?? "") === hehang) : rows;
    return list.map((r) => {
      const code = String(r[valueField] ?? "");
      const name = String(r[labelField] ?? "");
      return { value: code, label: name ? `${code} — ${name}` : code };
    });
  }, [rows, hehang, familyField, valueField, labelField]);

  // NHỚ lựa chọn (hệ hàng + sản phẩm) qua điều hướng: lưu localStorage theo
  // emitStateKey (chung cho các trang cùng bộ lọc). Mở lại / qua trang khác →
  // khôi phục cả 2 → list tự tải định mức của SP đã chọn.
  const persistKey = `filter-sel:${emitStateKey}`;
  const skipSaveRef = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ khôi phục 1 lần khi mount (persistKey ổn định)
  useEffect(() => {
    try {
      const r = localStorage.getItem(persistKey);
      if (r) {
        const saved = JSON.parse(r) as { hehang?: string; masp?: string };
        if (saved.hehang) setHehang(saved.hehang);
        if (saved.masp) pageState.set(emitStateKey, saved.masp);
      }
    } catch {}
  }, [persistKey]);
  useEffect(() => {
    // Bỏ lần lưu đầu (mount) để không ghi đè giá trị đã lưu bằng giá trị rỗng
    // trước khi effect khôi phục chạy.
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    try {
      localStorage.setItem(persistKey, JSON.stringify({ hehang, masp }));
    } catch {}
  }, [hehang, masp, persistKey]);

  const [dropOpen, setDropOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dropPos = useDropdownPosition(triggerRef, dropOpen);

  // Đóng dropdown khi click ngoài.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ gắn/gỡ listener khi dropOpen đổi
  useEffect(() => {
    if (!dropOpen) return;
    const handler = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (!triggerRef.current?.contains(tgt) && !panelRef.current?.contains(tgt))
        setDropOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropOpen]);

  const filteredProducts = useMemo(() => {
    const q = searchQ.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
    return productOptions.filter((o) => {
      if (!q) return true;
      const norm = (o.label + " " + (o.value ?? ""))
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/đ/g, "d");
      return norm.includes(q);
    });
  }, [productOptions, searchQ]);

  const selectedLabel = productOptions.find((o) => o.value === masp)?.label ?? masp;
  const title = (cfg.title as string) || "Sản phẩm";

  return (
    <div className="px-2 pt-4 pb-1.5 flex items-center gap-1.5 text-xs">
      {/* Combobox sản phẩm — tiêu đề nổi trên border top */}
      <div className="flex-1 min-w-0 relative">
        {/* Label nổi trên border */}
        <span className="absolute -top-[9px] left-2 z-10 px-0.5 text-[10px] leading-none text-muted bg-bg pointer-events-none select-none">
          {title}
          {loading ? " …" : ` (${productOptions.length})`}
        </span>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            setDropOpen((o) => !o);
            setSearchQ("");
          }}
          className="input flex w-full items-center justify-between gap-2 text-left h-7 text-xs"
        >
          <span className={cn("truncate", !masp && "text-muted")}>
            {masp ? selectedLabel : "— Chọn —"}
          </span>
          <I.ChevronDown size={12} className="shrink-0 text-muted" />
        </button>

        {dropOpen &&
          dropPos &&
          createPortal(
            <div
              ref={panelRef}
              style={{
                position: "fixed",
                top: dropPos.top,
                left: dropPos.left,
                minWidth: Math.max(dropPos.width, 280),
              }}
              className="z-[1000] max-w-[min(460px,92vw)] rounded-md border border-border bg-panel shadow-lg flex flex-col"
            >
              {/* Family chips — cuộn ngang */}
              {families.length > 0 && (
                <div className="flex gap-1 px-2 py-1.5 border-b border-border overflow-x-auto shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setHehang("");
                      pageState.set(emitStateKey, "");
                    }}
                    className={cn(
                      "px-2 h-5 rounded-full text-[10px] border whitespace-nowrap transition-colors",
                      !hehang
                        ? "bg-accent text-white border-accent"
                        : "border-border text-muted hover:border-accent hover:text-text",
                    )}
                  >
                    Tất cả
                  </button>
                  {families.map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => {
                        setHehang(f.value);
                        pageState.set(emitStateKey, "");
                      }}
                      className={cn(
                        "px-2 h-5 rounded-full text-[10px] border whitespace-nowrap transition-colors",
                        hehang === f.value
                          ? "bg-accent text-white border-accent"
                          : "border-border text-muted hover:border-accent hover:text-text",
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              )}
              {/* Search */}
              <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5 shrink-0">
                <I.Search size={12} className="shrink-0 text-muted" />
                <input
                  // biome-ignore lint/a11y/noAutofocus: mở dropdown → focus ô search ngay
                  autoFocus
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder="Tìm…"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted/60"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setDropOpen(false);
                    if (e.key === "Enter" && filteredProducts[0]) {
                      pageState.set(emitStateKey, filteredProducts[0].value);
                      setDropOpen(false);
                    }
                  }}
                />
              </div>
              {/* Product list */}
              <ul className="max-h-60 overflow-y-auto py-1">
                {filteredProducts.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-muted italic">Không có kết quả</li>
                ) : (
                  filteredProducts.map((o) => (
                    <li key={o.value}>
                      <button
                        type="button"
                        onClick={() => {
                          pageState.set(emitStateKey, o.value);
                          setDropOpen(false);
                        }}
                        className={cn(
                          "w-full px-3 py-1.5 text-left text-sm",
                          o.value === masp
                            ? "font-medium text-accent bg-accent/5"
                            : "text-text/90 hover:bg-hover/40",
                        )}
                      >
                        <span className="truncate block">{o.label}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>,
            document.body,
          )}
      </div>

      {/* Nạp lại */}
      <button
        type="button"
        onClick={() => {
          if (refreshDsId) pageState.set(`__refresh:ds:${refreshDsId}`, Date.now());
        }}
        className="shrink-0 w-7 h-7 flex items-center justify-center rounded border border-border text-muted hover:text-text hover:bg-hover/50 transition-colors"
        title="Nạp lại"
      >
        <I.RefreshCw size={13} />
      </button>
    </div>
  );
}
