import { useEffect } from "react";

/** Kéo-để-cuộn NGANG trên container overflow-auto.
 *
 *  Nguyên tắc: chỉ "chiếm" pointer khi gesture RÕ RÀNG là ngang
 *  (|dx| > |dy| × 1.5 và |dx| > 6px). Kéo dọc / chéo / text-select
 *  vẫn dùng hành vi gốc của trình duyệt — bôi đen chữ vẫn hoạt động.
 *
 *  - Chỉ kích hoạt khi pointer DOWN trên <td> (body), không phải <th>.
 *  - Không can thiệp input/button/a/select/textarea/contenteditable.
 *  - Sau khi commit scroll: nuốt click (capture phase) để row-click không nổ.
 *  - Kéo chưa đủ ngưỡng hoặc kéo dọc: click vẫn bubble bình thường.
 */
export function useDragScroll(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    // biome-ignore lint/style/noNonNullAssertion: guarded by runtime check below
    const node = ref.current!;
    if (!node) return;

    const SKIP = "input, button, a, select, textarea, [contenteditable], [role='spinbutton']";

    let capturedId: number | null = null;
    let startX = 0;
    let startY = 0;
    let startSL = 0;
    let scrolling = false; // đã commit sang chế độ scroll ngang

    function onPointerDown(e: PointerEvent) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (!target.closest("td")) return;
      if (target.closest(SKIP)) return;

      capturedId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      startSL = node.scrollLeft;
      scrolling = false;
      // Chưa capture — chờ xác định hướng gesture trong pointermove
    }

    function onPointerMove(e: PointerEvent) {
      if (e.pointerId !== capturedId) return;
      const dx = startX - e.clientX;
      const dy = startY - e.clientY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (!scrolling) {
        if (absDx < 6 && absDy < 6) return; // chưa đủ để quyết định

        if (absDx > absDy * 1.5) {
          // Gesture ngang rõ ràng → commit scroll, capture pointer
          scrolling = true;
          node.setPointerCapture(e.pointerId);
          node.classList.add("is-drag-scrolling");
        } else {
          // Kéo dọc / chéo → nhường lại cho browser (text-select, scroll dọc)
          capturedId = null;
          return;
        }
      }

      node.scrollLeft = startSL + dx;
    }

    function onPointerUp(e: PointerEvent) {
      if (e.pointerId !== capturedId) return;
      capturedId = null;
      node.classList.remove("is-drag-scrolling");
      try {
        node.releasePointerCapture(e.pointerId);
      } catch {}
    }

    // Nuốt click (capture phase) sau khi đã scroll để row-click không nổ
    function onClickCapture(e: MouseEvent) {
      if (scrolling) {
        e.stopPropagation();
        scrolling = false;
      }
    }

    node.addEventListener("pointerdown", onPointerDown);
    node.addEventListener("pointermove", onPointerMove);
    node.addEventListener("pointerup", onPointerUp);
    node.addEventListener("pointercancel", onPointerUp);
    node.addEventListener("click", onClickCapture, { capture: true });

    return () => {
      node.removeEventListener("pointerdown", onPointerDown);
      node.removeEventListener("pointermove", onPointerMove);
      node.removeEventListener("pointerup", onPointerUp);
      node.removeEventListener("pointercancel", onPointerUp);
      node.removeEventListener("click", onClickCapture, { capture: true });
      node.classList.remove("is-drag-scrolling");
    };
  }, [ref]);
}
