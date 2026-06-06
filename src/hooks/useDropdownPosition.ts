/* ==========================================================
   useDropdownPosition — toạ độ (fixed) cho dropdown render qua portal,
   bám đáy phần tử anchor và cập nhật khi cuộn/resize.

   Vì sao cần: dropdown `absolute` lồng trong container `overflow-hidden`
   hoặc có `transform` (vd card trang + ScaleToFit ở ConsumerPage) sẽ bị
   CẮT và/hoặc SCALE. Portal ra <body> + position:fixed theo
   getBoundingClientRect() thì hiển thị đúng vị trí trên màn hình, không
   phụ thuộc ancestor.
   ========================================================== */
import { type RefObject, useLayoutEffect, useState } from "react";

export interface DropdownPos {
  top: number;
  left: number;
  width: number;
}

export function useDropdownPosition<T extends HTMLElement>(
  anchorRef: RefObject<T | null>,
  open: boolean,
): DropdownPos | null {
  const [pos, setPos] = useState<DropdownPos | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    // capture=true để bắt cả cuộn ở container lồng bên trong, không chỉ window.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, anchorRef]);
  return pos;
}
