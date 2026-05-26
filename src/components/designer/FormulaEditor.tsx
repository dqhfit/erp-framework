/* ==========================================================
   FormulaEditor — Inspector cho field type="formula":
   - Multi-line textarea với syntax hint
   - Function picker (chip clickable, group theo category)
   - Field picker — insert {field_name}
   - Live preview với sample row
   ========================================================== */
import { useMemo, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Chip, FormField, Input } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { evaluate, FORMULA_FUNCTIONS, type FormulaCategory, type FormulaFn } from "@/lib/formula";
import { cn } from "@/lib/utils";

interface FormulaEditorProps {
  /** Expression hiện tại */
  value: string;
  onChange: (next: string) => void;
  /** Các field khác để insert dạng {field} */
  availableFields?: Array<{ key: string; label: string; type?: string }>;
  /** Sample row dùng cho live preview */
  sampleRow?: Record<string, unknown>;
}

const CATEGORY_LABEL: Record<FormulaCategory, string> = {
  math: "Toán học",
  logic: "Logic",
  text: "Văn bản",
  date: "Ngày tháng",
  agg: "Tổng hợp",
};

const CATEGORY_ORDER: FormulaCategory[] = ["math", "logic", "text", "date", "agg"];

export function FormulaEditor({
  value,
  onChange,
  availableFields = [],
  sampleRow = {},
}: FormulaEditorProps) {
  const t = useT();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [filter, setFilter] = useState("");
  const [activeCat, setActiveCat] = useState<FormulaCategory | "all">("all");

  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = FORMULA_FUNCTIONS.filter((f) => {
      if (activeCat !== "all" && f.category !== activeCat) return false;
      if (!q) return true;
      return f.name.toLowerCase().includes(q) || f.hint.toLowerCase().includes(q);
    });
    const out: Record<FormulaCategory, FormulaFn[]> = {
      math: [],
      logic: [],
      text: [],
      date: [],
      agg: [],
    };
    for (const f of filtered) out[f.category].push(f);
    return out;
  }, [filter, activeCat]);

  // Insert text vào vị trí cursor
  const insertAtCursor = (snippet: string, selectInside?: [number, number]) => {
    const ta = taRef.current;
    if (!ta) {
      onChange(value + snippet);
      return;
    }
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const next = value.slice(0, start) + snippet + value.slice(end);
    onChange(next);
    // Restore cursor on next tick
    requestAnimationFrame(() => {
      ta.focus();
      if (selectInside) {
        ta.selectionStart = start + selectInside[0];
        ta.selectionEnd = start + selectInside[1];
      } else {
        const pos = start + snippet.length;
        ta.selectionStart = ta.selectionEnd = pos;
      }
    });
  };

  const insertField = (key: string) => insertAtCursor(`{${key}}`);
  const insertFn = (fn: FormulaFn) => {
    // Hàm 0 arg → "FN()", có arg → "FN(<đặt cursor>)"
    const isNoArg = fn.args.trim() === "()";
    if (isNoArg) {
      insertAtCursor(`${fn.name}()`);
    } else {
      const snippet = `${fn.name}()`;
      // Cursor đặt giữa () → mark vùng select để user gõ đè
      insertAtCursor(snippet, [fn.name.length + 1, fn.name.length + 1]);
    }
  };

  // Live preview
  const preview = useMemo(() => {
    if (!value.trim()) return { ok: true, value: "—" } as const;
    return evaluate(value, sampleRow);
  }, [value, sampleRow]);

  return (
    <div className="space-y-3">
      <FormField label="Công thức" hint="Dùng {field_name} để tham chiếu, gọi hàm như FUNC(arg).">
        <textarea
          ref={taRef}
          className="input font-mono text-[13px]"
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="{price} * {qty}"
          spellCheck={false}
        />
      </FormField>

      {/* Live preview */}
      <div className="rounded-md border border-border bg-bg-soft p-2.5">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted uppercase tracking-wider">{t("field.formula_preview")}</span>
          {preview.ok ? <Chip variant="success">✓ OK</Chip> : <Chip variant="danger">✗ Lỗi</Chip>}
        </div>
        <div className="mt-1 font-mono text-sm break-all">
          {preview.ok ? (
            <span className="text-text">{formatValue(preview.value)}</span>
          ) : (
            <span className="text-danger">{preview.error}</span>
          )}
        </div>
      </div>

      {/* Field picker */}
      {availableFields.length > 0 && (
        <div>
          <div className="text-[11px] uppercase text-muted mb-1 tracking-wider">
            {t("field.insert_field")}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {availableFields.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => insertField(f.key)}
                className="px-2 h-7 rounded-sm text-xs border border-border bg-panel-2 hover:bg-hover/40 font-mono flex items-center gap-1.5"
                title={`${f.label}${f.type ? ` (${f.type})` : ""}`}
              >
                <I.Plus size={10} /> {`{${f.key}}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Function library */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[11px] uppercase text-muted tracking-wider">Hàm có sẵn</div>
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Tìm hàm..."
            className="h-7 text-xs w-32"
          />
        </div>

        <div className="flex flex-wrap gap-1 mb-2">
          <CatPill active={activeCat === "all"} onClick={() => setActiveCat("all")}>
            Tất cả
          </CatPill>
          {CATEGORY_ORDER.map((c) => (
            <CatPill key={c} active={activeCat === c} onClick={() => setActiveCat(c)}>
              {CATEGORY_LABEL[c]}
            </CatPill>
          ))}
        </div>

        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
          {CATEGORY_ORDER.map((cat) => {
            const list = grouped[cat];
            if (!list.length) return null;
            return (
              <div key={cat}>
                <div className="text-[10px] uppercase text-muted mb-1 sticky top-0 bg-panel py-0.5">
                  {CATEGORY_LABEL[cat]}
                </div>
                <div className="flex flex-wrap gap-1">
                  {list.map((fn) => (
                    <button
                      key={fn.name}
                      type="button"
                      onClick={() => insertFn(fn)}
                      className="px-2 h-7 rounded-sm text-xs border border-border bg-panel-2 hover:bg-hover/40 hover:border-accent/50 font-mono flex items-center gap-1"
                      title={`${fn.name}${fn.args} — ${fn.hint}\nVí dụ: ${fn.example}`}
                    >
                      {fn.name}
                      <span className="text-muted text-[10px]">{fn.args}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange("")}
        icon={<I.Trash size={12} />}
        disabled={!value}
      >
        Xoá công thức
      </Button>
    </div>
  );
}

function CatPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2 h-6 rounded-sm text-[11px] border",
        active
          ? "bg-accent text-white border-accent"
          : "bg-panel-2 border-border text-muted hover:bg-hover/40",
      )}
    >
      {children}
    </button>
  );
}

function formatValue(v: unknown): string {
  if (v === undefined) return "(empty)";
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
