import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path
    .split(".")
    .reduce<unknown>((acc, k) => (acc == null ? acc : (acc as Record<string, unknown>)[k]), obj);
}
