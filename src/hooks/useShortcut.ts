/* ==========================================================
   useShortcut — đăng ký phím tắt theo id (binding lấy từ preferences
   của tài khoản, fallback mặc định). Mọi component dùng hook này nên
   binding đổi ở /settings/shortcuts có hiệu lực ngay (cùng subscribe
   preferences store).
   ========================================================== */
import { useEffect, useRef } from "react";
import {
  comboMatches,
  comboUsesCmdOrAlt,
  isTypingTarget,
  SHORTCUT_DEFS,
  type ShortcutDef,
} from "@/lib/shortcuts";
import { usePreferences } from "@/stores/preferences";

/** Combo đã giải (override theo tài khoản hoặc mặc định) cho 1 shortcut id. */
export function useShortcutCombo(id: string): string {
  const overrides = usePreferences((s) => s.prefs.shortcuts);
  const def = SHORTCUT_DEFS.find((d) => d.id === id);
  return overrides?.[id] ?? def?.defaultCombo ?? "";
}

/** Toàn bộ shortcut + combo đã giải (cho trang cài đặt). */
export function useResolvedShortcuts(): Array<ShortcutDef & { combo: string }> {
  const overrides = usePreferences((s) => s.prefs.shortcuts);
  return SHORTCUT_DEFS.map((d) => ({ ...d, combo: overrides?.[d.id] ?? d.defaultCombo }));
}

/**
 * Đăng ký 1 phím tắt theo id. handler luôn gọi bản mới nhất (ref nội bộ),
 * nên truyền closure trực tiếp được. enabled=false → tạm tắt (vd exit-preview
 * chỉ bật khi đang xem trước).
 */
export function useShortcut(id: string, handler: () => void, opts?: { enabled?: boolean }): void {
  const combo = useShortcutCombo(id);
  const enabled = opts?.enabled ?? true;
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled || !combo) return;
    const onKey = (e: KeyboardEvent) => {
      if (!comboMatches(e, combo)) return;
      // Tổ hợp KHÔNG có Cmd/Alt (phím đơn, /, …) bỏ qua khi đang gõ trong ô nhập
      // — trừ Escape (luôn cho phép, vd thoát xem trước).
      if (!comboUsesCmdOrAlt(combo) && combo !== "escape" && isTypingTarget(document.activeElement))
        return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [combo, enabled]);
}
