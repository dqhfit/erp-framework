import { cn } from "@/lib/utils";

interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  className?: string;
}
export function Switch({ checked, onChange, label, className }: SwitchProps) {
  return (
    <label className={cn("flex items-center gap-2 cursor-pointer select-none", className)}>
      <span
        onClick={() => onChange(!checked)}
        className={cn(
          "w-8 h-[18px] rounded-full relative transition-colors",
          checked ? "bg-accent" : "bg-panel-2 border border-border",
        )}
      >
        <span
          className={cn(
            "absolute top-[2px] w-3 h-3 rounded-full bg-white transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-[2px]",
          )}
        />
      </span>
      {label && <span className="text-sm">{label}</span>}
    </label>
  );
}
