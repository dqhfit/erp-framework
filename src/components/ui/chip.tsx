import { cn } from "@/lib/utils";
import type { HTMLAttributes, ReactNode } from "react";

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "accent" | "success" | "warning" | "danger";
  children?: ReactNode;
}
export function Chip({ variant = "default", className, children, ...props }: ChipProps) {
  return (
    <span className={cn("chip", variant !== "default" && `chip-${variant}`, className)} {...props}>
      {children}
    </span>
  );
}
