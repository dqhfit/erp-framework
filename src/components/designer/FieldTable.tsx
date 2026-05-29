/* ==========================================================
   FieldTable.tsx — Bảng field ngang cho EntityDesigner.
   Mỗi hàng = 1 field, mỗi cột = 1 thuộc tính (label, name,
   type, required, unique, visible, ref). Inline-edit trực tiếp.
   ========================================================== */

import { useEffect, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { useT } from "@/hooks/useT";
import { FALLBACK_FIELD_TYPE, ftLabel, getFieldTypes } from "@/lib/field-types";
import type { EntityField, MockEntity } from "@/lib/object-types";
import { cn } from "@/lib/utils";

interface FieldTableProps {
  fields: EntityField[];
  selectedId: string | null;
  entities: MockEntity[];
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<EntityField>) => void;
  onReorder: (from: number, to: number) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}

/* ── Inline text input ───────────────────────────────────── */
function CellInput({
  value,
  onChange,
  mono,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing, value]);

  const commit = () => {
    if (draft.trim() !== value) onChange(draft.trim());
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
          e.stopPropagation();
        }}
        className={cn(
          "w-full h-6 px-1 rounded border border-accent bg-panel text-sm outline-none",
          mono && "font-mono text-[11px]",
        )}
        placeholder={placeholder}
      />
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onDoubleClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") setEditing(true);
      }}
      className={cn(
        "block w-full truncate cursor-text rounded px-1 hover:bg-hover/40",
        mono ? "font-mono text-[11px] text-muted" : "text-sm",
        !value && "text-muted italic",
      )}
      title={value || placeholder}
    >
      {value || <span className="opacity-50">{placeholder}</span>}
    </span>
  );
}

/* ── Type-picker dropdown ────────────────────────────────── */
function TypePicker({ value, onChange }: { value: string; onChange: (t: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fieldTypes = getFieldTypes();
  const ft = fieldTypes.find((f) => f.id === value) ?? FALLBACK_FIELD_TYPE;
  const IC = I[ft.icon] ?? I.Type;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-7 h-7 rounded-md border border-border bg-panel-2 flex items-center justify-center text-muted hover:border-accent hover:text-accent transition-colors",
          open && "border-accent text-accent",
        )}
        title={ftLabel(ft, t)}
      >
        <IC size={13} />
      </button>

      {open && (
        <div className="absolute left-0 top-8 z-50 w-52 rounded-lg border border-border bg-panel shadow-lg py-1 max-h-72 overflow-y-auto">
          {fieldTypes.map((f) => {
            const FIC = I[f.icon] ?? I.Type;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  onChange(f.id);
                  setOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-hover/50 transition-colors",
                  f.id === value && "bg-accent/10 text-accent",
                )}
              >
                <FIC size={13} className="shrink-0" />
                <span className="flex-1 text-left">{ftLabel(f, t)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Ref entity picker ───────────────────────────────────── */
function RefCell({
  value,
  entities,
  onChange,
}: {
  value: string | undefined;
  entities: MockEntity[];
  onChange: (ref: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const target = entities.find((e) => e.id === value || e.name === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "h-6 px-2 rounded text-xs border border-dashed border-border hover:border-accent transition-colors truncate max-w-[96px]",
          target ? "text-accent bg-accent/8" : "text-muted",
        )}
        title={target ? target.name : "Chọn entity"}
      >
        {target ? `→ ${target.name}` : "—"}
      </button>

      {open && (
        <div className="absolute left-0 top-7 z-50 w-44 rounded-lg border border-border bg-panel shadow-lg py-1 max-h-56 overflow-y-auto">
          <button
            type="button"
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
            className="w-full px-3 py-1.5 text-sm text-left text-muted hover:bg-hover/50"
          >
            — (Xóa ref)
          </button>
          {entities.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => {
                onChange(e.name);
                setOpen(false);
              }}
              className={cn(
                "w-full px-3 py-1.5 text-sm text-left hover:bg-hover/50 font-mono",
                (e.id === value || e.name === value) && "bg-accent/10 text-accent",
              )}
            >
              {e.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Checkbox cell ───────────────────────────────────────── */
function CheckCell({
  checked,
  onChange,
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      title={title}
      className="w-3.5 h-3.5 cursor-pointer accent-accent"
    />
  );
}

/* ── Row ────────────────────────────────────────────────── */
function FieldTableRow({
  field,
  idx,
  active,
  entities,
  onSelect,
  onUpdate,
  onReorder,
  onDelete,
  onDuplicate,
}: {
  field: EntityField;
  idx: number;
  active: boolean;
  entities: MockEntity[];
  onSelect: () => void;
  onUpdate: (patch: Partial<EntityField>) => void;
  onReorder: (from: number, to: number) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const t = useT();
  const [dragging, setDragging] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const isRef =
    field.type === "lookup" || field.type === "multi-lookup" || field.type === "collection";

  return (
    <tr
      onClick={onSelect}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("text/field-idx")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        const from = e.dataTransfer.getData("text/field-idx");
        if (from !== "") onReorder(Number.parseInt(from, 10), idx);
        setDragOver(false);
      }}
      className={cn(
        "group border-b border-border cursor-pointer select-none transition-colors",
        active ? "bg-accent/10" : "hover:bg-hover/20",
        dragging && "opacity-40",
        dragOver && "outline outline-2 outline-accent outline-offset-[-2px]",
      )}
    >
      {/* Drag handle */}
      <td className="w-6 pl-2">
        <span
          draggable
          onMouseDown={(e) => e.preventDefault()}
          onDragStart={(e) => {
            e.dataTransfer.setData("text/field-idx", String(idx));
            e.dataTransfer.effectAllowed = "move";
            setDragging(true);
          }}
          onDragEnd={() => setDragging(false)}
          className="flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <I.Grip size={13} className="text-muted opacity-0 group-hover:opacity-100 cursor-grab" />
        </span>
      </td>

      {/* Type icon */}
      <td className="w-8 px-1" onClick={(e) => e.stopPropagation()}>
        <TypePicker value={field.type} onChange={(type) => onUpdate({ type })} />
      </td>

      {/* Ref */}
      <td className="w-[108px] px-1" onClick={(e) => e.stopPropagation()}>
        {isRef ? (
          <RefCell value={field.ref} entities={entities} onChange={(ref) => onUpdate({ ref })} />
        ) : (
          <span className="text-muted text-xs px-1">—</span>
        )}
      </td>

      {/* Label */}
      <td className="min-w-[100px] max-w-[180px] px-1" onClick={(e) => e.stopPropagation()}>
        <CellInput
          value={field.label}
          placeholder="Label"
          onChange={(label) => onUpdate({ label })}
        />
      </td>

      {/* Name */}
      <td className="min-w-[80px] max-w-[140px] px-1" onClick={(e) => e.stopPropagation()}>
        <CellInput
          value={field.name}
          placeholder="name"
          mono
          onChange={(name) => onUpdate({ name })}
        />
      </td>

      {/* Required */}
      <td className="w-8 text-center" onClick={(e) => e.stopPropagation()}>
        <CheckCell
          checked={!!field.required}
          onChange={(required) => onUpdate({ required })}
          title={t("field.required")}
        />
      </td>

      {/* Unique */}
      <td className="w-8 text-center" onClick={(e) => e.stopPropagation()}>
        <CheckCell
          checked={!!field.unique}
          onChange={(unique) => onUpdate({ unique })}
          title="Unique"
        />
      </td>

      {/* Visible */}
      <td className="w-8 text-center" onClick={(e) => e.stopPropagation()}>
        <CheckCell
          checked={field.defaultVisible !== false}
          onChange={(v) => onUpdate({ defaultVisible: v })}
          title="Hiển thị mặc định"
        />
      </td>

      {/* Actions */}
      <td className="w-14 pr-2">
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
            className="w-6 h-6 rounded-sm hover:bg-hover/60 flex items-center justify-center text-muted"
            title={t("field.duplicate")}
          >
            <I.Copy size={11} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="w-6 h-6 rounded-sm hover:bg-danger/15 flex items-center justify-center text-muted hover:text-danger"
            title={t("field.delete_btn")}
          >
            <I.Trash size={11} />
          </button>
        </div>
      </td>
    </tr>
  );
}

/* ── Main component ─────────────────────────────────────── */
export function FieldTable({
  fields,
  selectedId,
  entities,
  onSelect,
  onUpdate,
  onReorder,
  onDelete,
  onDuplicate,
}: FieldTableProps) {
  return (
    <div className="card overflow-x-clip">
      <table className="w-full text-sm border-collapse min-w-[640px]">
        <thead className="sticky top-0 z-10 bg-panel-2">
          <tr className="border-b border-border bg-panel-2 text-muted text-[11px] uppercase tracking-wide">
            <th className="w-6 pl-2 py-2" />
            <th className="w-8 px-1 py-2 text-center">Type</th>
            <th className="w-[108px] px-1 py-2 text-left font-medium">Ref</th>
            <th className="min-w-[100px] px-1 py-2 text-left font-medium">Label</th>
            <th className="min-w-[80px] px-1 py-2 text-left font-medium">name</th>
            <th className="w-8 py-2 text-center" title="Required">
              Req
            </th>
            <th className="w-8 py-2 text-center" title="Unique">
              Uniq
            </th>
            <th className="w-8 py-2 text-center" title="Hiển thị mặc định">
              Vis
            </th>
            <th className="w-14 pr-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {fields.map((f, idx) => (
            <FieldTableRow
              key={f.id ?? idx}
              field={f}
              idx={idx}
              active={selectedId === f.id}
              entities={entities}
              onSelect={() => onSelect(f.id)}
              onUpdate={(patch) => onUpdate(f.id, patch)}
              onReorder={onReorder}
              onDelete={() => onDelete(f.id)}
              onDuplicate={() => onDuplicate(f.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
