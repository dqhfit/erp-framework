import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";
export function Kbd({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("kbd", className)} {...props} />;
}
