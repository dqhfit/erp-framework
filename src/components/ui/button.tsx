import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  children?: ReactNode;
}

export function Button({
  variant = "default",
  size = "md",
  icon,
  className,
  children,
  ...props
}: ButtonProps) {
  const isIconOnly = !children && !!icon;
  return (
    <button
      className={cn(
        "btn",
        `btn-${variant}`,
        size === "sm" && "btn-sm",
        size === "lg" && "btn-lg",
        isIconOnly && "btn-icon",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
