/* ==========================================================
   FeedbackFab — nút nổi kéo-thả được, hiện trên mọi route.
   - Kéo: Pointer Events API (pointer capture → drag mượt ra ngoài button).
   - Click vs drag: ngưỡng 5px; nếu di < 5px → mở modal.
   - Vị trí persist IndexedDB (erp_ui / fab_pos / "feedback").
     IDB đọc async → bắt đầu ở góc phải-dưới, nhảy về vị trí đã lưu
     sau vài ms (thường không nhận ra được).
   ========================================================== */
import { useEffect, useRef, useState } from "react";
import { SubmitFeedbackModal } from "@/components/feedback/SubmitFeedbackModal";
import { I } from "@/components/Icons";
import { useT } from "@/hooks/useT";

// ── IndexedDB helpers (key-value đơn giản, không cần lib) ──────────────

const IDB_NAME = "erp_ui";
const IDB_STORE = "fab_pos";
const IDB_KEY = "feedback";
const IDB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbRead(): Promise<{ x: number; y: number } | null> {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve((req.result as { x: number; y: number } | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function idbWrite(pos: { x: number; y: number }): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(pos, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
}

// ── Component ───────────────────────────────────────────────────────────

const SIZE = 48; // w-12 h-12

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

function defaultPos() {
  return { x: window.innerWidth - SIZE - 24, y: window.innerHeight - SIZE - 24 };
}

export function FeedbackFab() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(defaultPos);

  // Đọc vị trí đã lưu từ IDB sau khi mount.
  useEffect(() => {
    idbRead().then((saved) => {
      if (!saved) return;
      setPos({
        x: clamp(saved.x, 0, window.innerWidth - SIZE),
        y: clamp(saved.y, 0, window.innerHeight - SIZE),
      });
    });
  }, []);

  const drag = useRef<{ px: number; py: number; bx: number; by: number } | null>(null);
  const didMove = useRef(false);
  const latestPos = useRef(pos);
  latestPos.current = pos;
  const btnRef = useRef<HTMLButtonElement>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { px: e.clientX, py: e.clientY, bx: pos.x, by: pos.y };
    didMove.current = false;
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
      idbWrite(latestPos.current);
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
