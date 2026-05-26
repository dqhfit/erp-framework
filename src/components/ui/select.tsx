import type { ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  children: ReactNode;
}
export function Select({ className, children, ...props }: SelectProps) {
  return (
    <select className={cn("input", className)} {...props}>
      {children}
    </select>
  );
}
