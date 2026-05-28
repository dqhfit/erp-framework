/* ==========================================================
   field-row.tsx — 1 dòng hiển thị field trong EntityDesigner.
   Drag-and-drop reorder + select/duplicate/delete inline.
   Tách khỏi EntityDesigner.tsx (P2.7 refactor) để giảm monolith.
   ========================================================== */

import { useState } from "react";
import { I } from "@/components/Icons";
import { Chip } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { FALLBACK_FIELD_TYPE, ftLabel, getFieldTypes } from "@/lib/field-types";
import type { EntityField } from "@/lib/object-types";
import { cn } from "@/lib/utils";

export interface FieldRowProps {
  field: EntityField;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  idx: number;
  onReorder: (from: number, to: number) => void;
}

export function FieldRow({
  field,
  active,
  onSelect,
  onDelete,
  onDuplicate,
  idx,
  onReorder,
}: FieldRowProps) {
  const t = useT();
  const ft =
    getFieldTypes().find((f) => f.id === field.type) ?? getFieldTypes()[0] ?? FALLBACK_FIELD_TYPE;
  const IC = I[ft.icon] ?? I.Type;
  const [dragging, setDragging] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
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
        "flex items-center gap-3 px-3 h-12 cursor-pointer select-none group transition-colors",
        active ? "bg-accent/10" : "hover:bg-hover/30",
        dragging && "dragging",
        dragOver && "drop-zone-active",
      )}
    >
      <span
        draggable
        onMouseDown={(e) => e.preventDefault()}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/field-idx", String(idx));
          e.dataTransfer.effectAllowed = "move";
          setDragging(true);
        }}
        onDragEnd={() => setDragging(false)}
        className="shrink-0 flex items-center"
      >
        <I.Grip size={14} className="text-muted opacity-0 group-hover:opacity-100 cursor-grab" />
      </span>
      <div className="w-7 h-7 rounded-md bg-panel-2 border border-border flex items-center justify-center text-muted shrink-0">
        <IC size={13} />
      </div>
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <div className="font-medium truncate">{field.label}</div>
        <span className="font-mono text-[11px] text-muted truncate">{field.name}</span>
      </div>
      <Chip>{ftLabel(ft, t)}</Chip>
      {field.required && <Chip variant="warning">{t("field.required")}</Chip>}
      {field.type === "lookup" && field.ref && <Chip variant="accent">→ {field.ref}</Chip>}
      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate();
          }}
          className="w-6 h-6 rounded-sm hover:bg-hover/60 flex items-center justify-center text-muted"
          title={t("field.duplicate")}
        >
          <I.Copy size={12} />
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
          <I.Trash size={12} />
        </button>
      </div>
    </div>
  );
}

/** Sinh sample row cho live-preview formula. Re-export để FieldInspector dùng. */
export function sampleValueFor(type: string): unknown {
  switch (type) {
    case "number":
    case "integer":
    case "currency":
      return 100;
    case "boolean":
    case "bool":
      return true;
    case "date":
      return new Date().toISOString().slice(0, 10);
    case "datetime":
      return new Date().toISOString();
    case "json":
      return { sample: true };
    default:
      return "demo";
  }
}
