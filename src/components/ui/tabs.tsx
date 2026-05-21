import { cn } from "@/lib/utils";

interface TabOption<T extends string> {
  value: T;
  label: string;
}
interface TabsProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: TabOption<T>[];
  className?: string;
}
export function Tabs<T extends string>({ value, onChange, options, className }: TabsProps<T>) {
  return (
    <div className={cn("flex border-b border-border", className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "px-3 h-9 text-sm border-b-2 -mb-px transition-colors",
            value === opt.value
              ? "border-accent text-text"
              : "border-transparent text-muted hover:text-text",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
