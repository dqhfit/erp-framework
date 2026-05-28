/* ==========================================================
   format.ts — Hàm định dạng hiển thị dùng chung (tiền tệ, số…).
   Tách khỏi object-types.ts để tên file phản ánh đúng nội dung.
   ========================================================== */

/** Định dạng số thành tiền VND, vd 84500000 → "84.500.000 ₫". */
export function formatVND(n: number): string {
  return `${n.toLocaleString("vi-VN")} ₫`;
}

import type { EntityField, FieldFormat } from "@/lib/object-types";

/**
 * Áp dụng FieldFormat lên giá trị thô để hiển thị. Chỉ dùng ở read-only
 * contexts (table cell, detail view) — input form dùng giá trị thô.
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
    const df = fmt.dateFormat ?? "dd/MM/yyyy";
    if (df === "relative") return relativeDate(String(value));
    try {
      const d = new Date(String(value));
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
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) return String(value);
      const df = fmt.dateFormat ?? "dd/MM/yyyy";
      const tf = fmt.timeFormat ?? "HH:mm";
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
    return bv ? (fmt.trueLabel ?? "Có") : (fmt.falseLabel ?? "Không");
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
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.round(diff / 1000);
  if (secs < 60) return "vừa xong";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} phút trước`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} giờ trước`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} ngày trước`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} tháng trước`;
  return `${Math.round(months / 12)} năm trước`;
}
