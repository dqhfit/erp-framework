import { useDeferredValue, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Input, Modal } from "@/components/ui";
import { normalizeVi } from "@/lib/text-utils";

/** Tối đa option render ra DOM/lần — danh sách lớn cap để không lag. */
const RENDER_CAP = 150;

type Option = { value: string; label: string };

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  title: string;
  separator?: string;
  disabled?: boolean;
};

function splitValue(value: string, separator: string): string[] {
  return value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function MultiLookupPicker({
  value,
  onChange,
  options,
  title,
  separator = ",",
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<string[]>([]);
  // Precompute chuỗi bỏ-dấu 1 lần/option (không normalize lại mỗi phím gõ).
  const normIndex = useMemo(
    () => options.map((o) => normalizeVi(`${o.value} ${o.label}`)),
    [options],
  );
  const deferredQuery = useDeferredValue(query);
  const filtered = useMemo(() => {
    const q = normalizeVi(deferredQuery.trim());
    if (!q) return options;
    return options.filter((_, i) => (normIndex[i] ?? "").includes(q));
  }, [options, normIndex, deferredQuery]);
  const shown = filtered.length > RENDER_CAP ? filtered.slice(0, RENDER_CAP) : filtered;
  const overflow = filtered.length - shown.length;

  const show = () => {
    setDraft(splitValue(value, separator));
    setQuery("");
    setOpen(true);
  };

  const toggle = (optionValue: string) => {
    setDraft((current) =>
      current.includes(optionValue)
        ? current.filter((item) => item !== optionValue)
        : [...current, optionValue],
    );
  };

  return (
    <>
      <button
        type="button"
        className="input w-full flex items-center justify-between gap-2 text-left"
        disabled={disabled}
        onClick={show}
      >
        <span className={value ? "truncate" : "truncate text-muted"}>
          {value || `Chọn ${title.toLocaleLowerCase("vi")}`}
        </span>
        <I.MoreHorizontal size={14} className="shrink-0 text-muted" />
      </button>
      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title={`Chọn ${title.toLocaleLowerCase("vi")}`}
          width={560}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Đóng
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  onChange(draft.join(`${separator} `));
                  setOpen(false);
                }}
              >
                Chọn
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="relative">
              <I.Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Tìm ${title.toLocaleLowerCase("vi")}…`}
                className="pl-8"
                autoFocus
              />
            </div>
            <div className="max-h-[440px] overflow-y-auto rounded-md border border-border">
              {filtered.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted">Không có kết quả</div>
              ) : (
                <>
                  {shown.map((option) => (
                    <label
                      key={option.value}
                      className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 hover:bg-hover"
                    >
                      <input
                        type="checkbox"
                        className="accent-accent"
                        checked={draft.includes(option.value)}
                        onChange={() => toggle(option.value)}
                      />
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    </label>
                  ))}
                  {overflow > 0 && (
                    <div className="px-3 py-2 text-xs text-muted/70 italic">
                      Còn {overflow} mục — gõ thêm để thu hẹp…
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
