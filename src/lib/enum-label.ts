/* ==========================================================
   enum-label.ts — Chọn nhãn enum theo locale hiện tại.
   Hỗ trợ vi/en (theo i18n app). Fallback xuống vi nếu en
   không có; xuống value (code) nếu cả 2 thiếu.
   ========================================================== */
import type { Lang } from "@/i18n/dict";

export interface LabeledValue {
  value: string;
  label?: string;
  labelEn?: string;
}

/** Chọn nhãn hiển thị dựa trên ngôn ngữ. */
export function pickLabel(opt: LabeledValue, lang: Lang): string {
  if (lang === "en") return opt.labelEn || opt.label || opt.value;
  return opt.label || opt.labelEn || opt.value;
}

/** Tiện ích: hash {value → display label} cho một danh sách enum values. */
export function buildLabelMap(values: LabeledValue[], lang: Lang): Record<string, string> {
  const m: Record<string, string> = {};
  for (const v of values) m[v.value] = pickLabel(v, lang);
  return m;
}

/** Chọn nhãn FIELD theo locale — chấp nhận shape {label, labelEn}. */
export function pickFieldLabel(
  f: { label: string; labelEn?: string | null },
  lang: Lang,
): string {
  if (lang === "en") return f.labelEn || f.label;
  return f.label || f.labelEn || "";
}
