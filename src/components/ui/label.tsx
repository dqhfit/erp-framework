import type { LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5",
        className,
      )}
      {...props}
    />
  );
}
