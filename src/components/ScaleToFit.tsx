/* ==========================================================
   ScaleToFit — co giãn nội dung cho VỪA khung cha, ĐỒNG ĐỀU
   (giữ tỉ lệ). Đo kích thước tự nhiên của nội dung + kích thước
   khung rồi áp transform: scale(min(W/nw, H/nh)) và căn giữa
   (letterbox). Dùng cho thành phần trang ở cả PageDesigner (preview)
   lẫn ConsumerPage (widget thật).

   Lưu ý: khi khung chưa có kích thước (vd mobile auto-height) →
   fallback render nội dung bình thường (không transform).
   ========================================================== */

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

/* KHÔNG transform-scale các widget này:
   - Danh sách/tương tác (list, form, table…): giữ nguyên kích thước, tự
     CUỘN khi tràn — scale làm nội dung nhỏ xíu, khó đọc + lệch vùng bấm.
   - Responsive renderer (chart, map): tự lấp khung sẵn — scale gây mờ/méo.
   Chỉ widget hiển thị TĨNH (kpi, html) mới co giãn vừa khung. */
const NON_SCALABLE_KINDS = new Set([
  "list",
  "detail",
  "form",
  "chart",
  "kanban",
  "split",
  "grid",
  "search",
  "filter",
  "combobox",
  "listbox",
  "tagbox",
  "calendar",
  "map",
  "pivot",
  "action",
  "actionbar",
  "note",
  "banve-type",
]);

/** Loại widget có nên co giãn theo khung không (false = giữ nguyên + cuộn). */
export function isScalableKind(kind: string): boolean {
  return !NON_SCALABLE_KINDS.has(kind);
}

interface Transform {
  scale: number;
  x: number;
  y: number;
  active: boolean;
}

const IDLE: Transform = { scale: 1, x: 0, y: 0, active: false };

export function ScaleToFit({ children }: { children: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [tf, setTf] = useState<Transform>(IDLE);
  const lastRef = useRef<Transform>(IDLE);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box || !inner) return;

    let raf = 0;
    const measure = () => {
      const bw = box.clientWidth;
      const bh = box.clientHeight;
      // Kích thước tự nhiên của nội dung (transform không ảnh hưởng layout-size).
      const nw = inner.scrollWidth;
      const nh = inner.scrollHeight;
      let next: Transform;
      if (!bw || !bh || !nw || !nh) {
        next = IDLE; // khung/nội dung chưa đo được → render thường
      } else {
        const scale = Math.min(bw / nw, bh / nh);
        next = {
          scale,
          x: (bw - nw * scale) / 2,
          y: (bh - nh * scale) / 2,
          active: true,
        };
      }
      const prev = lastRef.current;
      // Tránh setState dư (chống vòng lặp ResizeObserver).
      if (
        prev.active === next.active &&
        Math.abs(prev.scale - next.scale) < 0.001 &&
        Math.abs(prev.x - next.x) < 0.5 &&
        Math.abs(prev.y - next.y) < 0.5
      ) {
        return;
      }
      lastRef.current = next;
      setTf(next);
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };

    const ro = new ResizeObserver(schedule);
    ro.observe(box);
    ro.observe(inner);
    schedule();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={boxRef} className="relative w-full h-full overflow-hidden">
      <div
        ref={innerRef}
        className={tf.active ? "absolute top-0 left-0" : undefined}
        style={
          tf.active
            ? {
                width: "max-content",
                transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.scale})`,
                transformOrigin: "top left",
              }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
