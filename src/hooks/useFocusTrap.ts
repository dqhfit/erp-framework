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
  // Guard Escape giả do native file dialog: Chrome (đặc biệt trên Linux/GTK)
  // phát Escape vào trang khi dialog đóng — kể cả sau khi đã CHỌN file. Bắt theo
  // vòng đời dialog (không phụ thuộc timing mong manh):
  //   - fileDialogActive = true khi click file input (dialog đang mở, có thể lâu).
  //   - khi window focus lại (dialog đóng) HOẶC change fire → mở cửa sổ chặn 1200ms.
  const fileDialogActive = useRef(false);
  const fileGuardUntil = useRef(0);

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

    const isFileInput = (el: EventTarget | null) =>
      (el as HTMLInputElement | null)?.tagName === "INPUT" &&
      (el as HTMLInputElement).type === "file";

    // Click vào file input → dialog sắp mở. Dùng capture + window để bắt mọi
    // input kể cả trong portal lồng nhau.
    const handleFileClick = (e: Event) => {
      if (isFileInput(e.target)) fileDialogActive.current = true;
    };
    // change fire khi CHỌN file (không fire khi cancel).
    const handleFileChange = (e: Event) => {
      if (isFileInput(e.target)) {
        fileDialogActive.current = false;
        fileGuardUntil.current = Date.now() + 1200;
      }
    };
    // window focus lại = native dialog vừa đóng (cả chọn lẫn cancel). Mở cửa sổ
    // chặn để nuốt Escape giả phát ngay sau đó.
    const handleWinFocus = () => {
      if (fileDialogActive.current) {
        fileDialogActive.current = false;
        fileGuardUntil.current = Date.now() + 1200;
      }
    };
    window.addEventListener("click", handleFileClick, true);
    window.addEventListener("change", handleFileChange, true);
    window.addEventListener("focus", handleWinFocus);

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Nuốt Escape giả từ file dialog: đang mở, hoặc trong cửa sổ chặn sau khi đóng.
        const tgt = e.target as HTMLInputElement | null;
        const act = document.activeElement as HTMLInputElement | null;
        if (
          fileDialogActive.current ||
          Date.now() < fileGuardUntil.current ||
          tgt?.type === "file" ||
          act?.type === "file"
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
      window.removeEventListener("click", handleFileClick, true);
      window.removeEventListener("change", handleFileChange, true);
      window.removeEventListener("focus", handleWinFocus);
      // Restore focus chỉ khi previous element còn trong DOM.
      const prev = previousFocusRef.current;
      if (prev && document.body.contains(prev)) prev.focus();
    };
  }, [open]); // onClose được đọc qua ref — không cần trong deps

  return containerRef;
}
