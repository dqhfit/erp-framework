/* ==========================================================
   page-status.ts — Định nghĩa CỜ trạng thái cho trang.

   2 nguồn cờ:
   1. BUILT-IN (cố định trong code) — vòng đời chuẩn: Mới tạo → Đang làm →
      Chờ duyệt → Hoàn thành → Đã xuất bản / Lưu trữ.
   2. TÙY CHỈNH ("cờ của tôi") — người dùng tự thêm, lưu DB (page_flags),
      nạp qua store. Mỗi cờ có id (uuid) + nhãn + màu token + icon.

   `pages.status` lưu KEY built-in (vd "new") HOẶC id (uuid) cờ tùy chỉnh.
   `resolveFlag(status, customFlags)` trả về 1 PageFlagDef thống nhất để render.

   MÀU: luôn dùng token semantic (accent/accent-2/success/warning/danger/
   neutral) → tự đổi theo theme sáng/tối. KHÔNG hardcode hex/palette.
   ========================================================== */
import type { FlagColor, PageFlag } from "@erp-framework/client";
import type { IconName } from "@/lib/object-types";

export type { FlagColor, PageFlag } from "@erp-framework/client";

/** Một cờ đã chuẩn hoá để render (built-in hoặc tùy chỉnh). */
export interface PageFlagDef {
  /** Giá trị lưu vào pages.status (key built-in hoặc id uuid). */
  value: string;
  label: string;
  color: FlagColor;
  icon: IconName;
  /** true = cờ built-in (không sửa/xoá được); false = cờ tùy chỉnh. */
  builtin: boolean;
}

/** Bộ cờ built-in, theo thứ tự vòng đời. */
export const BUILTIN_PAGE_FLAGS: readonly PageFlagDef[] = [
  { value: "new", label: "Mới tạo", color: "accent-2", icon: "Sparkles", builtin: true },
  { value: "in_progress", label: "Đang làm", color: "warning", icon: "Loader", builtin: true },
  { value: "review", label: "Chờ duyệt", color: "accent", icon: "Eye", builtin: true },
  { value: "done", label: "Hoàn thành", color: "success", icon: "CheckCircle", builtin: true },
  { value: "published", label: "Đã xuất bản", color: "success", icon: "Globe", builtin: true },
  { value: "archived", label: "Lưu trữ", color: "neutral", icon: "Archive", builtin: true },
] as const;

const BUILTIN_BY_KEY = new Map(BUILTIN_PAGE_FLAGS.map((f) => [f.value, f]));

/** Danh sách màu token chọn được cho cờ tùy chỉnh + nhãn tiếng Việt. */
export const FLAG_COLOR_OPTIONS: ReadonlyArray<{ value: FlagColor; label: string }> = [
  { value: "accent", label: "Chủ đạo" },
  { value: "accent-2", label: "Phụ" },
  { value: "success", label: "Xanh lá" },
  { value: "warning", label: "Vàng" },
  { value: "danger", label: "Đỏ" },
  { value: "neutral", label: "Xám" },
];

/* Class Tailwind theo token — viết LITERAL để Tailwind quét được (không nối
   chuỗi động). chip = nền nhạt + chữ + viền; dot = chấm tròn đặc; text = chữ. */
export const FLAG_COLOR_CLASSES: Record<FlagColor, { chip: string; dot: string; text: string }> = {
  accent: {
    chip: "bg-accent/15 text-accent border-accent/30",
    dot: "bg-accent",
    text: "text-accent",
  },
  "accent-2": {
    chip: "bg-accent-2/15 text-accent-2 border-accent-2/30",
    dot: "bg-accent-2",
    text: "text-accent-2",
  },
  success: {
    chip: "bg-success/15 text-success border-success/30",
    dot: "bg-success",
    text: "text-success",
  },
  warning: {
    chip: "bg-warning/15 text-warning border-warning/30",
    dot: "bg-warning",
    text: "text-warning",
  },
  danger: {
    chip: "bg-danger/15 text-danger border-danger/30",
    dot: "bg-danger",
    text: "text-danger",
  },
  neutral: { chip: "bg-hover text-muted border-border", dot: "bg-muted", text: "text-muted" },
};

/** Icon mặc định cho cờ tùy chỉnh khi người dùng không chọn riêng. */
export const DEFAULT_CUSTOM_FLAG_ICON: IconName = "Tag";

/** Chuẩn hoá 1 cờ tùy chỉnh (DB) → PageFlagDef. */
export function customFlagToDef(f: PageFlag): PageFlagDef {
  return {
    value: f.id,
    label: f.label,
    color: f.color,
    icon: (f.icon as IconName) || DEFAULT_CUSTOM_FLAG_ICON,
    builtin: false,
  };
}

/**
 * Phân giải giá trị `pages.status` thành cờ để render.
 * - null/"" → null (chưa gắn cờ).
 * - khớp key built-in → cờ built-in.
 * - else coi là id cờ tùy chỉnh → tra trong customFlags.
 * - id trỏ cờ đã xoá (mồ côi) → null.
 */
export function resolveFlag(
  status: string | null | undefined,
  customFlags: readonly PageFlag[],
): PageFlagDef | null {
  if (!status) return null;
  const builtin = BUILTIN_BY_KEY.get(status);
  if (builtin) return builtin;
  const custom = customFlags.find((f) => f.id === status);
  return custom ? customFlagToDef(custom) : null;
}

/** Toàn bộ cờ chọn được (built-in + tùy chỉnh) cho dropdown picker. */
export function allFlagDefs(customFlags: readonly PageFlag[]): PageFlagDef[] {
  return [...BUILTIN_PAGE_FLAGS, ...customFlags.map(customFlagToDef)];
}
