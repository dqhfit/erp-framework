/* ==========================================================
   SearchableSelect — combobox xổ xuống có ô nhập tìm kiếm.
   Thay <select> native khi danh sách dài / cần lọc nhanh.

   - value/onChange theo string (caller tự convert number nếu cần).
   - Mở panel: focus ô search, lọc theo label (không phân biệt hoa
     thường + bỏ dấu), điều hướng phím ↑/↓/Enter/Esc.
   - Đóng khi click ra ngoài hoặc Esc; trả focus về trigger.
   ========================================================== */

import { useEffect, useMemo, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { cn } from "@/lib/utils";

export interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Khi set, chèn 1 mục value="" với nhãn này lên đầu (vd "— chọn —"). */
  emptyOption?: string;
  disabled?: boolean;
  className?: string;
}

/** Bỏ dấu tiếng Việt để so khớp tìm kiếm (đ→d, có dấu→không dấu). */
function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Chọn…",
  searchPlaceholder = "Tìm…",
  emptyText = "Không có kết quả",
  emptyOption,
  disabled,
  className,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Chèn mục rỗng "— chọn —" lên đầu nếu có emptyOption.
  const allOptions = useMemo(
    () => (emptyOption != null ? [{ value: "", label: emptyOption }, ...options] : options),
    [emptyOption, options],
  );

  const selected = allOptions.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return allOptions;
    return allOptions.filter((o) => normalize(o.label).includes(q));
  }, [allOptions, query]);

  // Đóng khi click ra ngoài.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Mở: focus ô search, đặt active vào item đang chọn.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    const idx = Math.max(
      0,
      allOptions.findIndex((o) => o.value === value),
    );
    setActiveIdx(idx);
    // Focus sau khi panel render.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, value, allOptions]);

  // Cuộn item active vào tầm nhìn.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[activeIdx];
      if (opt) pick(opt.value);
    }
  };

  return (
    <div ref={rootRef} className={cn("relative inline-block", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="input flex w-full items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={cn("truncate", !selected && "text-muted")}>
          {selected ? selected.label : placeholder}
        </span>
        <I.ChevronDown size={14} className="shrink-0 text-muted" />
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-1 min-w-full w-max max-w-[280px] rounded-md border border-border bg-panel shadow-lg">
          <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
            <I.Search size={13} className="shrink-0 text-muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIdx(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted/60"
            />
          </div>
          <ul ref={listRef} className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted italic">{emptyText}</li>
            ) : (
              filtered.map((o, i) => {
                const isSel = o.value === value;
                const isActive = i === activeIdx;
                return (
                  <li key={o.value}>
                    <button
                      type="button"
                      onClick={() => pick(o.value)}
                      onMouseEnter={() => setActiveIdx(i)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm",
                        isActive ? "bg-accent/10 text-text" : "text-text/90 hover:bg-hover/40",
                      )}
                    >
                      <span className="truncate">{o.label}</span>
                      {isSel && <I.Check size={13} className="shrink-0 text-accent" />}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
