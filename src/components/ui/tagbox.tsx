/* ==========================================================
   tagbox.tsx — Multi-select với suggestions từ list có sẵn +
   cho phép free-text (vd table chưa quét, hoặc proc do user gọi
   theo tên manual). Chip × để remove. Phím tắt:
     - Enter: add giá trị đang gõ (hoặc suggestion focused)
     - Backspace ở input rỗng: xóa chip cuối
     - ArrowDown/Up: di chuyển highlight trong dropdown
     - Esc: đóng dropdown
   - Nút "..." mở Picker Modal với tích chọn hàng loạt: search,
     chọn tất cả, bỏ chọn, hiển thị X/Y selected. Tắt khi
     enablePicker=false.
   ========================================================== */

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { I } from "@/components/Icons";
import { useT } from "@/hooks/useT";
import { Button } from "./button";
import { Modal } from "./modal";

export interface TagBoxProps {
  value: string[];
  onChange: (next: string[]) => void;
  /** Danh sách suggest. Mặc định empty (vẫn gõ tay được). */
  suggestions?: string[];
  placeholder?: string;
  disabled?: boolean;
  /** Không cho giá trị ngoài list. Mặc định false (free-text OK). */
  strict?: boolean;
  className?: string;
  /** ID dùng cho <label>. */
  id?: string;
  /** Lỗi hiển thị dưới input. */
  error?: string;
  /** Hiện nút "..." mở Picker Modal (tích chọn hàng loạt). Default true
   *  nếu có suggestions, false khi rỗng. */
  enablePicker?: boolean;
  /** Title của Picker Modal. */
  pickerTitle?: string;
}

export function TagBox({
  value,
  onChange,
  suggestions = [],
  placeholder,
  disabled = false,
  strict = false,
  className,
  id,
  error,
  enablePicker,
  pickerTitle,
}: TagBoxProps) {
  const t = useT();
  const showPicker = (enablePicker ?? suggestions.length > 0) && !disabled;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const resolvedPh = placeholder ?? t("tagbox.placeholder");
  const resolvedPickerTitle = pickerTitle ?? t("tagbox.picker_title");

  // Lọc + sort: bỏ những giá trị đã chọn, match query (case-insensitive).
  const filtered = useMemo(() => {
    const set = new Set(value.map((v) => v.toLowerCase()));
    const qLower = q.trim().toLowerCase();
    return suggestions
      .filter((s) => !set.has(s.toLowerCase()))
      .filter((s) => qLower === "" || s.toLowerCase().includes(qLower))
      .slice(0, 50);
  }, [suggestions, value, q]);

  // Click outside → close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  // Reset highlight khi filtered đổi.
  useEffect(() => {
    setHighlight(0);
  }, [q]);

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    if (strict && !suggestions.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
      return; // strict mode: bỏ giá trị ngoài list.
    }
    if (value.some((v) => v.toLowerCase() === trimmed.toLowerCase())) return;
    onChange([...value, trimmed]);
    setQ("");
    inputRef.current?.focus();
  };

  const removeTag = (tag: string) => {
    onChange(value.filter((v) => v !== tag));
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && filtered[highlight]) {
        addTag(filtered[highlight]);
      } else if (q.trim() && !strict) {
        addTag(q);
      }
    } else if (e.key === "Backspace" && q === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "," || e.key === ";") {
      // Cho phép paste comma-sep — convert ngay sang chip.
      e.preventDefault();
      if (q.trim()) addTag(q);
    }
  };

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <div
        className={cn(
          "flex flex-wrap items-center gap-1 min-h-[34px] px-2 py-1 border rounded bg-bg",
          error ? "border-danger" : "border-border",
          disabled && "opacity-60 pointer-events-none",
        )}
        onClick={() => inputRef.current?.focus()}
        onKeyDown={(e) => {
          // Cho click bằng bàn phím — Space/Enter focus input.
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
        role="button"
        tabIndex={-1}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 h-6 rounded bg-accent/10 text-accent text-xs"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeTag(tag);
              }}
              className="hover:text-danger leading-none"
              aria-label={t("tagbox.remove_tag", { tag })}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={value.length === 0 ? resolvedPh : ""}
          disabled={disabled}
          className="flex-1 min-w-[120px] bg-transparent outline-none text-sm h-7"
        />
        {showPicker && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPickerOpen(true);
            }}
            className="text-muted hover:text-text px-1 leading-none"
            title={t("tagbox.open_picker_title")}
            aria-label={t("tagbox.open_picker")}
          >
            <I.List size={14} />
          </button>
        )}
      </div>

      {open && (filtered.length > 0 || (q.trim() && !strict)) && (
        <div className="absolute z-10 mt-1 left-0 right-0 max-h-56 overflow-auto bg-bg border border-border rounded shadow">
          {q.trim() &&
            !strict &&
            !filtered.some((s) => s.toLowerCase() === q.trim().toLowerCase()) && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addTag(q);
                }}
                className="w-full text-left px-2 py-1.5 text-sm text-muted hover:bg-surface"
              >
                {t("tagbox.add_custom", { value: q.trim() })}
              </button>
            )}
          {filtered.map((s, i) => (
            <button
              type="button"
              key={s}
              onMouseDown={(e) => {
                e.preventDefault();
                addTag(s);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={cn(
                "w-full text-left px-2 py-1.5 text-sm",
                i === highlight ? "bg-surface" : "hover:bg-surface",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {error && <div className="text-xs text-danger mt-1">{error}</div>}

      {showPicker && (
        <PickerModal
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          title={resolvedPickerTitle}
          all={suggestions}
          selected={value}
          onApply={(next) => {
            onChange(next);
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

/* ── Picker modal: tích chọn hàng loạt với search + select all ───── */

function PickerModal({
  open,
  onClose,
  title,
  all,
  selected,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  all: string[];
  selected: string[];
  onApply: (next: string[]) => void;
}) {
  const t = useT();
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState<Set<string>>(new Set());

  // Khi modal mở → khởi tạo draft từ selected hiện tại.
  useEffect(() => {
    if (open) {
      setDraft(new Set(selected));
      setFilter("");
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ reset khi mở
  }, [open]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return all;
    return all.filter((s) => s.toLowerCase().includes(f));
  }, [all, filter]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((s) => draft.has(s));

  const toggle = (s: string) => {
    const next = new Set(draft);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setDraft(next);
  };

  const selectAllFiltered = () => {
    const next = new Set(draft);
    for (const s of filtered) next.add(s);
    setDraft(next);
  };

  const clearAllFiltered = () => {
    const next = new Set(draft);
    for (const s of filtered) next.delete(s);
    setDraft(next);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={560}
      footer={
        <>
          <Button variant="default" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" size="sm" onClick={() => onApply([...draft])}>
            {t("tagbox.btn_apply", { count: draft.size })}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("tagbox.filter_ph")}
            className="flex-1 px-2 h-8 border border-border rounded bg-bg text-sm outline-none focus:border-accent"
            autoFocus
          />
          <span className="text-xs text-muted whitespace-nowrap">
            {filtered.length}/{all.length}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={allFilteredSelected ? clearAllFiltered : selectAllFiltered}
            className="px-2 h-6 border border-border rounded hover:bg-surface"
          >
            {allFilteredSelected ? t("tagbox.deselect_filtered") : t("tagbox.select_all_filtered")}
          </button>
          <button
            type="button"
            onClick={() => setDraft(new Set())}
            className="px-2 h-6 border border-border rounded hover:bg-surface"
          >
            {t("tagbox.clear_all")}
          </button>
          <div className="ml-auto text-muted">
            {t("tagbox.selected_count", { count: draft.size })}
          </div>
        </div>
        <ul className="border border-border rounded max-h-96 overflow-y-auto divide-y divide-border">
          {filtered.length === 0 && (
            <li className="p-3 text-sm text-muted text-center">{t("tagbox.no_results")}</li>
          )}
          {filtered.map((s) => {
            const checked = draft.has(s);
            return (
              <li key={s}>
                <label className="flex items-center gap-2 px-2 py-1.5 hover:bg-surface cursor-pointer">
                  <input type="checkbox" checked={checked} onChange={() => toggle(s)} />
                  <span className="text-sm font-mono">{s}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}
