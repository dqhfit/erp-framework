import { useEffect } from "react";

/** Kéo-để-cuộn trên container overflow-auto.
 *  - Chỉ kích hoạt khi pointer xuống trên <td> (cell dữ liệu), không phải <th>/header.
 *  - Không can thiệp input/button/a/select/textarea.
 *  - Nếu di chuyển > 5px: cuộn, nuốt click để row-click không nổ.
 *  - Nếu di chuyển ≤ 5px: click vẫn bubble bình thường.
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
    let startST = 0;
    let dragged = false;

    function onPointerDown(e: PointerEvent) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const target = e.target as HTMLElement;
      // Chỉ bắt đầu kéo khi pointer DOWN trên cell dữ liệu (td), không phải header (th)
      if (!target.closest("td")) return;
      if (target.closest(SKIP)) return;

      capturedId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      startSL = node.scrollLeft;
      startST = node.scrollTop;
      dragged = false;
      node.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: PointerEvent) {
      if (e.pointerId !== capturedId) return;
      const dx = startX - e.clientX;
      const dy = startY - e.clientY;

      if (!dragged && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        dragged = true;
        node.classList.add("is-drag-scrolling");
      }
      if (dragged) {
        node.scrollLeft = startSL + dx;
        node.scrollTop = startST + dy;
      }
    }

    function onPointerUp(e: PointerEvent) {
      if (e.pointerId !== capturedId) return;
      capturedId = null;
      node.classList.remove("is-drag-scrolling");
      try {
        node.releasePointerCapture(e.pointerId);
      } catch {}
    }

    // Nuốt click trong capture phase khi đã drag đủ xa
    function onClickCapture(e: MouseEvent) {
      if (dragged) {
        e.stopPropagation();
        dragged = false;
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
