import { cn } from "@/lib/utils";
import type { SelectHTMLAttributes, ReactNode } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  children: ReactNode;
}
export function Select({ className, children, ...props }: SelectProps) {
  return <select className={cn("input", className)} {...props}>{children}</select>;
}
