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

/* ─── Danh mục THAM KHẢO: phím tắt CỐ ĐỊNH theo từng màn hình ────────
   Khác SHORTCUT_DEFS (cấu hình được): đây là các phím gắn cứng trong
   từng component (bảng tính, trình soạn SQL, hộp thoại…). Chỉ để LIỆT KÊ
   cho người dùng biết — không rebind. Nguồn: quét handler keydown thực tế
   (tổng hợp tại /settings/shortcuts). "Ctrl/Cmd" = Ctrl (Win/Linux) /
   ⌘ (macOS). */
export interface ShortcutRefItem {
  /** Các tổ hợp hiển thị sẵn (mỗi phần tử 1 chip). */
  keys: string[];
  action: string;
}
export interface ShortcutRefGroup {
  /** Tên màn hình / ngữ cảnh. */
  scope: string;
  /** Khi nào phím có tác dụng. */
  hint?: string;
  items: ShortcutRefItem[];
}

export const SHORTCUT_REFERENCE: ShortcutRefGroup[] = [
  {
    scope: "Toàn cục",
    hint: "Mọi nơi trong ứng dụng, khi không gõ trong ô nhập.",
    items: [{ keys: ["/"], action: "Mở nhanh Command Palette" }],
  },
  {
    scope: "Command Palette (bảng lệnh)",
    hint: "Khi bảng lệnh đang mở.",
    items: [
      { keys: ["↑", "↓"], action: "Di chuyển giữa các mục" },
      { keys: ["Enter"], action: "Mở mục đang chọn" },
      { keys: ["Esc"], action: "Đóng bảng lệnh" },
    ],
  },
  {
    scope: "Hộp thoại & ngăn kéo (Modal / Drawer)",
    hint: "Khi một hộp thoại hoặc ngăn kéo đang mở.",
    items: [
      { keys: ["Esc"], action: "Đóng hộp thoại" },
      { keys: ["Tab", "Shift+Tab"], action: "Chuyển focus tới / lui, giữ focus bên trong" },
      { keys: ["Enter"], action: "Xác nhận / gửi (hộp thoại nhập, form)" },
    ],
  },
  {
    scope: "Ô chọn tìm kiếm & ô thẻ (Select, Tag)",
    hint: "Khi danh sách gợi ý đang mở.",
    items: [
      { keys: ["↑", "↓"], action: "Di chuyển giữa gợi ý" },
      { keys: ["Enter"], action: "Chọn gợi ý đang tô sáng" },
      { keys: ["Esc"], action: "Đóng danh sách gợi ý" },
      { keys: ["Backspace"], action: "Xoá thẻ cuối khi ô nhập trống (ô thẻ)" },
      { keys: [", ;"], action: "Ngăn cách để thêm nhiều thẻ (ô thẻ)" },
    ],
  },
  {
    scope: "Bảng tính (ExcelGrid)",
    hint: "Lưới nhập kiểu Excel, khi đang chọn ô.",
    items: [
      { keys: ["↑", "↓", "←", "→"], action: "Di chuyển ô đang chọn" },
      { keys: ["Shift + ↑↓←→"], action: "Mở rộng vùng chọn" },
      { keys: ["Tab", "Shift+Tab"], action: "Sang ô phải / trái" },
      { keys: ["Enter", "F2"], action: "Bắt đầu sửa ô (Shift+Enter: lên ô trên)" },
      { keys: ["Ctrl/Cmd+A"], action: "Chọn toàn bộ ô" },
      { keys: ["Delete", "Backspace"], action: "Xoá nội dung ô đang chọn" },
      { keys: ["Esc"], action: "Bỏ chọn / thoát sửa ô" },
      { keys: ["A–Z 0–9"], action: "Gõ ký tự bất kỳ để sửa ô ngay" },
    ],
  },
  {
    scope: "Bảng tính — khi sửa ô có công thức",
    items: [
      { keys: ["↑", "↓"], action: "Chọn hàm trong gợi ý" },
      { keys: ["Tab", "Enter"], action: "Chèn hàm gợi ý" },
      { keys: ["Enter"], action: "Lưu ô, xuống ô dưới" },
      { keys: ["Tab", "Shift+Tab"], action: "Lưu ô, sang phải / trái" },
      { keys: ["Esc"], action: "Đóng gợi ý" },
    ],
  },
  {
    scope: "Bảng dữ liệu (DataGrid) & trang xem",
    items: [
      { keys: ["Esc"], action: "Thoát chế độ phóng to toàn màn hình" },
      { keys: ["Enter"], action: "Mở dòng (khi dòng bấm được)" },
      { keys: ["Enter"], action: "Lưu ô đang sửa nhanh" },
      { keys: ["Esc"], action: "Huỷ sửa ô" },
    ],
  },
  {
    scope: "Trình dựng quy trình (Workflow Designer)",
    items: [
      { keys: ["Ctrl/Cmd+S"], action: "Lưu workflow (nháp)" },
      { keys: ["Delete", "Backspace"], action: "Xoá node / đường nối đang chọn" },
    ],
  },
  {
    scope: "Trình soạn SQL",
    hint: "Màn hình soạn truy vấn SQL của nguồn dữ liệu.",
    items: [
      { keys: ["Ctrl/Cmd+Enter", "F5"], action: "Chạy SQL (vùng chọn hoặc câu tại con trỏ)" },
      { keys: ["Ctrl/Cmd+Space"], action: "Mở gợi ý (autocomplete)" },
      { keys: ["↑", "↓"], action: "Chọn gợi ý" },
      { keys: ["Enter", "Tab"], action: "Chèn gợi ý" },
      { keys: ["Esc"], action: "Đóng gợi ý" },
    ],
  },
  {
    scope: "Trợ lý AI & AI Assist",
    items: [
      { keys: ["Enter"], action: "Gửi tin nhắn" },
      { keys: ["Shift+Enter"], action: "Xuống dòng (không gửi)" },
      { keys: ["Ctrl/Cmd+Enter"], action: "Tạo (generate) ở ô soạn code nguồn dữ liệu" },
    ],
  },
  {
    scope: "Sửa tên & form nhập liệu",
    hint: "Sửa tên entity/trường, sửa nội tuyến, đăng nhập, mời/tạo tài khoản…",
    items: [
      { keys: ["Enter"], action: "Lưu / gửi" },
      { keys: ["Esc"], action: "Huỷ chỉnh sửa" },
    ],
  },
  {
    scope: "Kéo chia khung (Split pane)",
    hint: "Khi focus vào thanh chia.",
    items: [{ keys: ["←", "→", "↑", "↓"], action: "Kéo thanh chia (bước 10px; giữ Shift = 50px)" }],
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
