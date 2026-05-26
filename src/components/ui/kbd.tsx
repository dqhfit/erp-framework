import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
export function Kbd({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("kbd", className)} {...props} />;
}
