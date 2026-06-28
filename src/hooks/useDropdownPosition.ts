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
  top?: number;
  bottom?: number;
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
      const spaceBelow = window.innerHeight - r.bottom;
      const spaceAbove = r.top;

      // Nếu không đủ chỗ ở dưới (cần khoảng 280px) và trên có nhiều chỗ hơn
      if (spaceBelow < 280 && spaceAbove > spaceBelow) {
        setPos({
          bottom: window.innerHeight - r.top + 4,
          left: r.left,
          width: r.width,
        });
      } else {
        setPos({
          top: r.bottom + 4,
          left: r.left,
          width: r.width,
        });
      }
    };
    // Gộp nhiều event scroll/resize trong 1 frame → 1 lần đo layout, tránh
    // getBoundingClientRect + setState dồn dập gây giật khi cuộn nhanh.
    let raf = 0;
    const onMove = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    };
    update();
    // capture=true để bắt cả cuộn ở container lồng bên trong, không chỉ window.
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, anchorRef]);
  return pos;
}
