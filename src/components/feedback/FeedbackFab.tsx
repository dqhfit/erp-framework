/* ==========================================================
   FeedbackFab — nút nổi kéo-thả được, hiện trên mọi route.
   - Kéo: Pointer Events API (pointer capture → drag mượt ra ngoài button).
   - Click vs drag: ngưỡng 5px; nếu di < 5px → mở modal.
   - Vị trí lưu localStorage, clamp vào viewport khi load.
   ========================================================== */
import { useRef, useState } from "react";
import { SubmitFeedbackModal } from "@/components/feedback/SubmitFeedbackModal";
import { I } from "@/components/Icons";
import { useT } from "@/hooks/useT";

const STORAGE_KEY = "feedback_fab_pos";
const SIZE = 48; // w-12 h-12

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

function loadPos() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const { x, y } = JSON.parse(raw) as { x: number; y: number };
      return {
        x: clamp(x, 0, window.innerWidth - SIZE),
        y: clamp(y, 0, window.innerHeight - SIZE),
      };
    }
  } catch {}
  return { x: window.innerWidth - SIZE - 24, y: window.innerHeight - SIZE - 24 };
}

export function FeedbackFab() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(loadPos);
  // Ref lưu điểm bắt đầu kéo; null = không kéo.
  const drag = useRef<{ px: number; py: number; bx: number; by: number } | null>(null);
  const didMove = useRef(false);
  // Luôn giữ ref đồng bộ state để onPointerUp đọc được vị trí mới nhất.
  const latestPos = useRef(pos);
  latestPos.current = pos;
  const btnRef = useRef<HTMLButtonElement>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // Chỉ xử lý chuột trái (button=0) hoặc cảm ứng/stylus.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { px: e.clientX, py: e.clientY, bx: pos.x, by: pos.y };
    didMove.current = false;
    // Giữ mọi pointer event trên button dù con trỏ thoát ra ngoài.
    btnRef.current?.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.px;
    const dy = e.clientY - drag.current.py;
    if (!didMove.current && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
    didMove.current = true;
    setPos({
      x: clamp(drag.current.bx + dx, 0, window.innerWidth - SIZE),
      y: clamp(drag.current.by + dy, 0, window.innerHeight - SIZE),
    });
  };

  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (!didMove.current) {
      setOpen(true);
    } else {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(latestPos.current));
      } catch {}
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title={t("feedback.fab_title")}
        aria-label={t("feedback.fab_title")}
        className="fixed z-40 w-12 h-12 rounded-full flex items-center justify-center text-white shadow-lg select-none touch-none cursor-move"
        style={{
          left: pos.x,
          top: pos.y,
          background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))",
        }}
      >
        <I.MessageSquare size={20} />
      </button>
      <SubmitFeedbackModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
