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
  // Dùng ref để luôn gọi phiên bản onClose mới nhất mà không cần
  // thêm nó vào deps — tránh effect re-run mỗi khi parent re-render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Timestamp của lần cuối file input trong container fire change.
  // Dùng để bỏ qua Escape do Chrome/Windows phát khi file picker đóng.
  const lastFileChangeMs = useRef(0);

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

    // Ghi nhận file change để guard Escape bên dưới.
    const handleFileChange = (e: Event) => {
      if ((e.target as HTMLInputElement | null)?.type === "file")
        lastFileChangeMs.current = Date.now();
    };
    container?.addEventListener("change", handleFileChange);

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Chrome/Windows fire Escape khi file picker đóng (cả sau khi chọn xong).
        // Guard 1: e.target là file input (nếu Escape fire trước khi input bị disabled).
        // Guard 2: activeElement là file input (nếu input chưa bị disabled/blur).
        // Guard 3: Escape trong vòng 500ms sau file change (trường hợp input đã disabled).
        const tgt = e.target as HTMLInputElement | null;
        const act = document.activeElement as HTMLInputElement | null;
        if (
          tgt?.type === "file" ||
          act?.type === "file" ||
          Date.now() - lastFileChangeMs.current < 500
        )
          return;
        e.stopPropagation();
        onCloseRef.current();
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
      container?.removeEventListener("change", handleFileChange);
      // Restore focus chỉ khi previous element còn trong DOM.
      const prev = previousFocusRef.current;
      if (prev && document.body.contains(prev)) prev.focus();
    };
  }, [open]); // onClose được đọc qua ref — không cần trong deps

  return containerRef;
}
