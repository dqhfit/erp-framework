/* ==========================================================
   SearchableSelect — combobox xổ xuống có ô nhập tìm kiếm.
   Thay <select> native khi danh sách dài / cần lọc nhanh.

   - value/onChange theo string (caller tự convert number nếu cần).
   - Mở panel: focus ô search, lọc theo label (không phân biệt hoa
     thường + bỏ dấu), điều hướng phím ↑/↓/Enter/Esc.
   - Đóng khi click ra ngoài hoặc Esc; trả focus về trigger.
   ========================================================== */

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { I } from "@/components/Icons";
import { useDropdownPosition } from "@/hooks/useDropdownPosition";
import { normalizeVi } from "@/lib/text-utils";
import { cn } from "@/lib/utils";

/** Tối đa option render ra DOM/lần — danh sách lớn cap để không lag.
 *  Phần dư hiện gợi ý "gõ thêm để thu hẹp". */
const RENDER_CAP = 150;

export interface SearchableSelectOption {
  value: string;
  label: string;
  /** Giá trị từng cột (chế độ nhiều cột) — render thẳng hàng theo columnHeaders. */
  cells?: string[];
  /** Chuỗi dùng để LỌC client (nếu khác label, vd gộp mọi cột). */
  searchText?: string;
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
  /** Class thêm cho nút trigger — vd thu nhỏ: "h-7! text-xs!". */
  triggerClassName?: string;
  /** Hiện ĐỦ nội dung option (xuống dòng thay vì cắt) + dropdown rộng hơn. */
  wrapOptions?: boolean;
  /** Ẩn ô tìm kiếm (dropdown ít option, vd bộ lọc 2-3 mục). */
  noSearch?: boolean;
  /** Mở dropdown ngay khi render (vd sửa ô lưới: nhấn đúp → mở chọn luôn). */
  autoOpen?: boolean;
  /** Gọi khi dropdown ĐÓNG (chọn xong / click ngoài / Esc) — cho ô lưới thoát
   *  chế độ sửa khi không chọn gì. */
  onClose?: () => void;
  /** Có → TÌM SERVER-SIDE: gọi mỗi khi gõ (caller tự debounce + nạp lại
   *  `options`). Khi set, BỎ lọc client (options chính là kết quả server). */
  onSearch?: (q: string) => void;
  /** Đang tải kết quả tìm (hiện dòng "Đang tìm…"). Dùng với onSearch. */
  loading?: boolean;
  /** Có → DROPDOWN NHIỀU CỘT: hiện hàng tiêu đề + mỗi option render theo
   *  `option.cells` thẳng hàng (lưới). Dropdown rộng hơn. */
  columnHeaders?: string[];
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
  triggerClassName,
  wrapOptions,
  noSearch,
  autoOpen,
  onClose,
  onSearch,
  loading,
  columnHeaders,
}: SearchableSelectProps) {
  const multiCol = !!columnHeaders && columnHeaders.length > 0;
  const gridCols = multiCol
    ? `minmax(64px,auto) ${Array((columnHeaders?.length ?? 1) - 1)
        .fill("minmax(0,1fr)")
        .join(" ")}`.trim()
    : undefined;
  const [open, setOpen] = useState(!!autoOpen);
  useEffect(() => {
    if (autoOpen) {
      setOpen(true);
    }
  }, [autoOpen]);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  // Báo caller khi dropdown đóng (true→false) — ô lưới thoát chế độ sửa.
  const prevOpen = useRef(open);
  useEffect(() => {
    if (prevOpen.current && !open) onClose?.();
    prevOpen.current = open;
  }, [open, onClose]);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Dropdown render qua portal ra <body> để không bị card/transform cắt.
  const pos = useDropdownPosition(triggerRef, open);

  // Chèn mục rỗng "— chọn —" lên đầu nếu có emptyOption.
  const allOptions = useMemo(
    () => (emptyOption != null ? [{ value: "", label: emptyOption }, ...options] : options),
    [emptyOption, options],
  );

  const selected = allOptions.find((o) => o.value === value);

  // Precompute chuỗi bỏ-dấu 1 lần/option (không normalize lại mỗi phím gõ).
  const normIndex = useMemo(
    () => allOptions.map((o) => normalizeVi(o.searchText ?? o.label)),
    [allOptions],
  );

  // Defer query → lọc+render chạy nền, ô input không bị chặn khi list lớn.
  const deferredQuery = useDeferredValue(query);
  const filtered = useMemo(() => {
    // Tìm server-side → options đã là kết quả server, không lọc client nữa.
    if (onSearch) return allOptions;
    const q = normalizeVi(deferredQuery.trim());
    if (!q) return allOptions;
    return allOptions.filter((_, i) => (normIndex[i] ?? "").includes(q));
  }, [allOptions, normIndex, deferredQuery, onSearch]);

  // Chỉ render tối đa RENDER_CAP mục — danh sách lớn không re-render toàn bộ DOM.
  const shown = filtered.length > RENDER_CAP ? filtered.slice(0, RENDER_CAP) : filtered;
  const overflow = filtered.length - shown.length;
  // List đang "cũ" trong lúc deferred bắt kịp query → làm mờ nhẹ cho biết.
  const stale = deferredQuery !== query;

  // Đóng khi click ra ngoài.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const tgt = e.target as Node;
      // Panel nằm trong portal (ngoài rootRef) → phải loại trừ panelRef,
      // nếu không click chọn item sẽ bị coi là "click ngoài" và đóng trước.
      if (rootRef.current && !rootRef.current.contains(tgt) && !panelRef.current?.contains(tgt)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Mở: focus ô search, đặt active vào item đang chọn. CHỈ chạy khi `open` đổi —
  // KHÔNG phụ thuộc value/allOptions, vì server-search cập nhật options mỗi lần gõ
  // sẽ làm effect re-run và setQuery("") → mất chữ đang gõ.
  // biome-ignore lint/correctness/useExhaustiveDependencies: value/allOptions đọc tại thời điểm mở; thêm vào deps sẽ reset ô tìm khi options đổi (server-search).
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
  }, [open]);

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
      setActiveIdx((i) => Math.min(i + 1, shown.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const opt = shown[activeIdx];
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
        className={cn(
          "input flex w-full items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50",
          triggerClassName,
        )}
      >
        <span
          className={cn("min-w-0 truncate", !selected && "text-muted")}
          title={selected ? selected.label : undefined}
        >
          {selected ? selected.label : placeholder}
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
              top: pos.top !== undefined ? pos.top : "auto",
              bottom: pos.bottom !== undefined ? pos.bottom : "auto",
              left: pos.left > window.innerWidth / 2 ? "auto" : pos.left,
              right:
                pos.left > window.innerWidth / 2
                  ? window.innerWidth - (pos.left + pos.width)
                  : "auto",
              minWidth: pos.width,
            }}
            className={cn(
              "z-[1000] w-max rounded-md border border-border bg-panel shadow-lg",
              multiCol
                ? "max-w-[min(480px,96vw)]"
                : wrapOptions
                  ? "max-w-[min(460px,92vw)]"
                  : "max-w-[280px]",
            )}
          >
            {!noSearch && (
              <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
                <I.Search size={13} className="shrink-0 text-muted" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActiveIdx(0);
                    onSearch?.(e.target.value);
                  }}
                  onKeyDown={onKeyDown}
                  placeholder={searchPlaceholder}
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted/60"
                />
              </div>
            )}
            {/* Hàng tiêu đề cột (chế độ nhiều cột). */}
            {multiCol && (
              <div
                className="grid gap-2 border-b border-border bg-panel-2/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted"
                style={{ gridTemplateColumns: gridCols }}
              >
                {columnHeaders?.map((h, ci) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: cột tĩnh, không đổi thứ tự
                  <span key={`${h}-${ci}`} className="truncate">
                    {h}
                  </span>
                ))}
              </div>
            )}
            <ul
              ref={listRef}
              className={cn(
                "max-h-60 overflow-y-auto py-1 transition-opacity",
                stale && "opacity-60",
              )}
            >
              {loading && <li className="px-3 py-1.5 text-xs text-muted italic">Đang tìm…</li>}
              {!loading && filtered.length === 0 ? (
                <li className="px-3 py-2 text-sm text-muted italic">{emptyText}</li>
              ) : (
                shown.map((o, i) => {
                  const isSel = o.value === value;
                  const isActive = i === activeIdx;
                  return (
                    <li key={o.value}>
                      <button
                        type="button"
                        onClick={() => pick(o.value)}
                        onMouseEnter={() => setActiveIdx(i)}
                        className={cn(
                          "w-full px-3 py-1.5 text-left text-sm",
                          isActive ? "bg-accent/10 text-text" : "text-text/90 hover:bg-hover/40",
                          isSel && "font-medium text-accent",
                        )}
                      >
                        {multiCol && o.cells ? (
                          <div
                            className="grid items-center gap-2"
                            style={{ gridTemplateColumns: gridCols }}
                          >
                            {o.cells.map((c, ci) => (
                              // biome-ignore lint/suspicious/noArrayIndexKey: cột tĩnh, không đổi thứ tự
                              <span key={`${o.value}-${ci}`} className="truncate" title={c}>
                                {c}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="flex items-center justify-between gap-2">
                            <span
                              className={wrapOptions ? "whitespace-normal break-words" : "truncate"}
                            >
                              {o.label}
                            </span>
                            {isSel && <I.Check size={13} className="shrink-0 text-accent" />}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })
              )}
              {overflow > 0 && (
                <li className="px-3 py-1.5 text-xs text-muted/70 italic border-t border-border/50">
                  Còn {overflow} mục — gõ thêm để thu hẹp…
                </li>
              )}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
