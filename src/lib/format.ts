/* ==========================================================
   format.ts — Hàm định dạng hiển thị dùng chung (tiền tệ, số…).
   Tách khỏi object-types.ts để tên file phản ánh đúng nội dung.
   ========================================================== */

/** Định dạng số thành tiền VND, vd 84500000 → "84.500.000 ₫". */
export function formatVND(n: number): string {
  return `${n.toLocaleString("vi-VN")} ₫`;
}

import type { EntityField, FieldFormat } from "@/lib/object-types";
import { useLocale } from "@/stores/locale";

/* ── Mặc định theo ngôn ngữ người dùng chọn (vi/en) ──────────
   Chỉ áp khi field KHÔNG cấu hình format riêng — per-field override
   (fmt.dateFormat/timeFormat/trueLabel...) luôn thắng. Pattern cứng
   (không Intl) để deterministic giữa môi trường/test. */
const LOCALE_DEFAULTS = {
  vi: {
    dateFormat: "dd/MM/yyyy",
    timeFormat: "HH:mm",
    trueLabel: "Có",
    falseLabel: "Không",
    rel: {
      now: "vừa xong",
      m: (n: number) => `${n} phút trước`,
      h: (n: number) => `${n} giờ trước`,
      d: (n: number) => `${n} ngày trước`,
      mo: (n: number) => `${n} tháng trước`,
      y: (n: number) => `${n} năm trước`,
    },
  },
  en: {
    dateFormat: "MM/dd/yyyy",
    timeFormat: "hh:mm a",
    trueLabel: "Yes",
    falseLabel: "No",
    rel: {
      now: "just now",
      m: (n: number) => `${n} min ago`,
      h: (n: number) => `${n}h ago`,
      d: (n: number) => `${n}d ago`,
      mo: (n: number) => `${n}mo ago`,
      y: (n: number) => `${n}y ago`,
    },
  },
} as const;

function localeDefaults() {
  const lang = useLocale.getState().lang;
  return LOCALE_DEFAULTS[lang === "en" ? "en" : "vi"];
}

/** Parse giá trị ngày an toàn: chuỗi date-only "YYYY-MM-DD" dựng LOCAL
 *  date theo từng phần (new Date(str) parse UTC → lệch ±1 ngày ở tz≠0 —
 *  bài học #9). Chuỗi có giờ → parse bình thường. */
function parseDateValue(value: unknown): Date {
  const s = String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(s);
}

/**
 * Áp dụng FieldFormat lên giá trị thô để hiển thị. Chỉ dùng ở read-only
 * contexts (table cell, detail view) — input form dùng giá trị thô.
 * Mặc định ngày/giờ/boolean đổi theo ngôn ngữ người dùng (useLocale).
 */
export function applyFieldFormat(field: EntityField, value: unknown): string {
  if (value == null) return "—";
  const fmt: FieldFormat = field.format ?? {};
  const type = field.type;

  // ── Số ──────────────────────────────────────────────
  if (type === "number" || type === "integer" || type === "currency" || type === "formula") {
    const raw = Number(value);
    if (Number.isNaN(raw)) return String(value);

    const decimals = fmt.decimals ?? (type === "currency" ? 0 : 2);
    let s = raw.toFixed(decimals);

    const sep = fmt.thousandSep ?? (type === "currency" ? "period" : "none");
    if (sep !== "none") {
      const [intPart, decPart] = s.split(".");
      const sepChar = sep === "comma" ? "," : sep === "period" ? "." : " ";
      const decChar = sep === "comma" ? "." : ",";
      s =
        (intPart ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, sepChar) +
        (decPart !== undefined ? decChar + decPart : "");
    }

    const sym = fmt.currencySymbol ?? (type === "currency" ? "₫" : "");
    if (sym) {
      s = (fmt.symbolPosition ?? "after") === "before" ? sym + s : s + sym;
    }
    return (fmt.prefix ?? "") + s + (fmt.suffix ?? "");
  }

  // ── Ngày ─────────────────────────────────────────────
  if (type === "date") {
    const df = fmt.dateFormat ?? localeDefaults().dateFormat;
    if (df === "relative") return relativeDate(String(value));
    try {
      const d = parseDateValue(value);
      if (Number.isNaN(d.getTime())) return String(value);
      return formatDate(d, df);
    } catch {
      return String(value);
    }
  }

  // ── Ngày + giờ ───────────────────────────────────────
  if (type === "datetime") {
    if (fmt.timeFormat === "relative") return relativeDate(String(value));
    try {
      const d = parseDateValue(value);
      if (Number.isNaN(d.getTime())) return String(value);
      const df = fmt.dateFormat ?? localeDefaults().dateFormat;
      const tf = fmt.timeFormat ?? localeDefaults().timeFormat;
      return `${formatDate(d, df)} ${formatTime(d, tf)}`;
    } catch {
      return String(value);
    }
  }

  // ── Văn bản ──────────────────────────────────────────
  if (type === "text" || type === "longtext") {
    const s = String(value);
    if (fmt.textTransform === "uppercase") return s.toUpperCase();
    if (fmt.textTransform === "lowercase") return s.toLowerCase();
    if (fmt.textTransform === "capitalize") return s.replace(/\b\w/g, (c) => c.toUpperCase());
    return s;
  }

  // ── Boolean ──────────────────────────────────────────
  if (type === "bool" || type === "boolean") {
    const bv = value === true || value === "true" || value === 1 || value === "1";
    return bv
      ? (fmt.trueLabel ?? localeDefaults().trueLabel)
      : (fmt.falseLabel ?? localeDefaults().falseLabel);
  }

  // Mảng → join
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function formatDate(d: Date, fmt: string): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return fmt.replace("dd", dd).replace("MM", MM).replace("yyyy", yyyy);
}

function formatTime(d: Date, fmt: string): string {
  const HH = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  if (fmt === "hh:mm a") {
    const h12 = d.getHours() % 12 || 12;
    const ampm = d.getHours() < 12 ? "AM" : "PM";
    return `${String(h12).padStart(2, "0")}:${mm} ${ampm}`;
  }
  return fmt.replace("HH", HH).replace("mm", mm).replace("ss", ss);
}

function relativeDate(iso: string): string {
  const rel = localeDefaults().rel;
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.round(diff / 1000);
  if (secs < 60) return rel.now;
  const mins = Math.round(secs / 60);
  if (mins < 60) return rel.m(mins);
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return rel.h(hrs);
  const days = Math.round(hrs / 24);
  if (days < 30) return rel.d(days);
  const months = Math.round(days / 30);
  if (months < 12) return rel.mo(months);
  return rel.y(Math.round(months / 12));
}
