/* ==========================================================
   useFocusTrap — Hook a11y cho Modal/Drawer:
   - Tab/Shift+Tab loop trong container
   - Tự focus phần tử focusable đầu tiên khi mở
   - Trả focus về element trigger khi đóng
   - Escape key gọi onClose
   Không thêm dependency mới (~30 dòng tự cài).
   ========================================================== */
import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useFocusTrap<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const containerRef = useRef<T>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Lưu focus hiện tại để restore khi đóng.
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const container = containerRef.current;
    if (container) {
      // Focus phần tử đầu tiên focusable; nếu không có, focus container.
      const first = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? container).focus();
    }

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !container) return;
      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      // Restore focus chỉ khi previous element còn trong DOM.
      const prev = previousFocusRef.current;
      if (prev && document.body.contains(prev)) prev.focus();
    };
  }, [open, onClose]);

  return containerRef;
}
