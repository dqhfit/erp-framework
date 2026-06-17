/* ==========================================================
   shortcuts.ts — Định nghĩa phím tắt + tiện ích so khớp tổ hợp.

   Tổ hợp được chuẩn hoá thành chuỗi canonical: modifier theo thứ tự
   cố định (mod → shift → alt) + phím chính, vd "mod+k", "mod+shift+z",
   "escape", "/". "mod" = Cmd trên macOS, Ctrl ở nơi khác.

   Người dùng có thể đổi binding ở /settings/shortcuts — override lưu
   theo tài khoản tại preferences.shortcuts (Record<id, combo>).
   ========================================================== */

export type ShortcutCategory = "global" | "designer";

export interface ShortcutDef {
  id: string;
  /** Nhãn hiển thị (tiếng Việt). */
  label: string;
  /** Mô tả ngắn. */
  desc: string;
  category: ShortcutCategory;
  /** Tổ hợp mặc định (canonical). */
  defaultCombo: string;
}

/** Danh mục để nhóm trong trang cài đặt. */
export const SHORTCUT_CATEGORIES: Array<{ key: ShortcutCategory; label: string; hint: string }> = [
  { key: "global", label: "Toàn cục", hint: "Dùng được ở mọi nơi trong ứng dụng." },
  {
    key: "designer",
    label: "Trình dựng trang",
    hint: "Chỉ hoạt động khi đang mở Trình dựng trang (Page Designer).",
  },
];

export const SHORTCUT_DEFS: ShortcutDef[] = [
  {
    id: "command-palette",
    label: "Mở Command Palette",
    desc: "Tìm nhanh trang / đối tượng / cài đặt",
    category: "global",
    defaultCombo: "mod+k",
  },
  {
    id: "toggle-agent",
    label: "Bật/tắt Trợ lý AI",
    desc: "Mở hoặc đóng khung chat AI",
    category: "global",
    defaultCombo: "mod+/",
  },
  {
    id: "designer-save",
    label: "Lưu",
    desc: "Lưu trang đang dựng",
    category: "designer",
    defaultCombo: "mod+s",
  },
  {
    id: "designer-undo",
    label: "Hoàn tác (Undo)",
    desc: "Hoàn tác thay đổi gần nhất",
    category: "designer",
    defaultCombo: "mod+z",
  },
  {
    id: "designer-redo",
    label: "Làm lại (Redo)",
    desc: "Làm lại thay đổi vừa hoàn tác",
    category: "designer",
    defaultCombo: "mod+shift+z",
  },
  {
    id: "designer-preview",
    label: "Xem trước",
    desc: "Bật chế độ xem trước trang",
    category: "designer",
    defaultCombo: "mod+shift+p",
  },
  {
    id: "designer-exit-preview",
    label: "Thoát xem trước",
    desc: "Tắt chế độ xem trước (khi đang xem trước)",
    category: "designer",
    defaultCombo: "escape",
  },
];

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || "");

/** Chuẩn hoá phím chính của event → token canonical. */
function normalizeKey(key: string): string {
  switch (key) {
    case " ":
    case "Spacebar":
      return "space";
    case "Escape":
    case "Esc":
      return "escape";
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    default:
      return key.toLowerCase();
  }
}

/** KeyboardEvent → chuỗi canonical (vd "mod+shift+z"). null nếu CHỈ bấm modifier. */
export function eventToCombo(e: KeyboardEvent): string | null {
  if (e.key === "Control" || e.key === "Meta" || e.key === "Shift" || e.key === "Alt") return null;
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");
  parts.push(normalizeKey(e.key));
  return parts.join("+");
}

/** So khớp event với combo canonical. */
export function comboMatches(e: KeyboardEvent, combo: string): boolean {
  return !!combo && eventToCombo(e) === combo;
}

/** Combo có dùng Cmd/Ctrl hoặc Alt không? (combo chỉ phím đơn/shift KHÔNG nên
 *  kích hoạt khi đang gõ trong ô nhập). */
export function comboUsesCmdOrAlt(combo: string): boolean {
  const parts = combo.split("+");
  return parts.includes("mod") || parts.includes("alt");
}

/** Phần tử đang focus có phải ô nhập liệu không. */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable === true;
}

/** Combo canonical → chuỗi hiển thị thân thiện (⌘⇧Z trên Mac, Ctrl+Shift+Z nơi khác). */
export function formatCombo(combo: string): string {
  if (!combo) return "—";
  const sep = isMac ? "" : "+";
  return combo
    .split("+")
    .map((p) => {
      switch (p) {
        case "mod":
          return isMac ? "⌘" : "Ctrl";
        case "shift":
          return isMac ? "⇧" : "Shift";
        case "alt":
          return isMac ? "⌥" : "Alt";
        case "escape":
          return "Esc";
        case "space":
          return "Space";
        case "up":
          return "↑";
        case "down":
          return "↓";
        case "left":
          return "←";
        case "right":
          return "→";
        default:
          return p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1);
      }
    })
    .join(sep);
}
