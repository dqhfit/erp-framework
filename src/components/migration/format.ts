/* Tiện ích format dùng chung cho UI migration (settings.migration + tabs). */

/** Thời gian -> chuỗi vi-VN; null/undefined -> "—". */
export function fmtTime(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("vi-VN");
}

/** Giá trị ô bất kỳ -> chuỗi hiển thị (sample rows). */
export function fmtCell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
