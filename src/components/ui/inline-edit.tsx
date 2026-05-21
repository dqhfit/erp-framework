import { useEffect, useState } from "react";

interface InlineEditProps {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
}
export function InlineEdit({ value, onChange, className = "", placeholder = "" }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (editing) {
    return (
      <input
        autoFocus
        className={`inline-edit-input ${className}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { onChange(draft); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { onChange(draft); setEditing(false); }
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
      />
    );
  }
  return (
    <span className={`inline-edit ${className}`} onClick={() => setEditing(true)} title="Click to edit">
      {value || <span className="text-muted">{placeholder}</span>}
    </span>
  );
}
