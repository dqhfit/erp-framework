import { useEffect, useRef, useState } from "react";

interface InlineEditProps {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
}
export function InlineEdit({ value, onChange, className = "", placeholder = "" }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const v = inputRef.current?.value ?? value;
    onChange(v);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        defaultValue={value}
        className={`inline-edit-input ${className}`}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <span
      className={`inline-edit ${className}`}
      onClick={() => setEditing(true)}
      title="Click to edit"
    >
      {value || <span className="text-muted">{placeholder}</span>}
    </span>
  );
}
