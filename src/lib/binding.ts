/* ==========================================================
   binding.ts — Phân giải EntityBinding string.
   Syntax: "tool" | "mcp:tool" | "proc:name". Empty/null = chưa bind.
   ========================================================== */

export type BindingKind = "mcp" | "proc";

export interface ParsedBinding {
  kind: BindingKind;
  name: string;
}

/** Phân giải binding string. Mặc định không prefix → MCP. */
export function parseBinding(s: string | undefined | null): ParsedBinding | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("proc:")) {
    return { kind: "proc", name: trimmed.slice(5).trim() };
  }
  if (trimmed.startsWith("mcp:")) {
    return { kind: "mcp", name: trimmed.slice(4).trim() };
  }
  return { kind: "mcp", name: trimmed };
}

/** Format ngược — chuẩn hoá về dạng prefixed. */
export function formatBinding(kind: BindingKind, name: string): string {
  return `${kind}:${name}`;
}
