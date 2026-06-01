import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

interface SplitPaneProps {
  left: ReactNode;
  right: ReactNode;
  /** Initial left panel width in pixels (default 420) */
  defaultLeftWidth?: number;
  /** Min left width in pixels (default 200) */
  minLeft?: number;
  /** Min right width in pixels (default 240) */
  minRight?: number;
  /** localStorage key to persist width */
  storageKey?: string;
  className?: string;
}

export function SplitPane({
  left,
  right,
  defaultLeftWidth = 420,
  minLeft = 200,
  minRight = 240,
  storageKey,
  className = "",
}: SplitPaneProps) {
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved) return Number(saved);
    }
    return defaultLeftWidth;
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startWidth.current = leftWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [leftWidth],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const containerW = containerRef.current.offsetWidth;
      const delta = e.clientX - startX.current;
      const newW = Math.max(
        minLeft,
        Math.min(containerW - minRight - 4, startWidth.current + delta),
      );
      setLeftWidth(newW);
    };

    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (storageKey) localStorage.setItem(storageKey, String(leftWidth));
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [leftWidth, minLeft, minRight, storageKey]);

  return (
    <div ref={containerRef} className={`flex min-h-0 flex-1 gap-0 ${className}`}>
      {/* Left panel */}
      <div
        className="flex min-h-0 flex-col overflow-hidden"
        style={{ width: leftWidth, minWidth: minLeft }}
      >
        {left}
      </div>

      {/* Drag handle — keyboard: ←/→ resize, min/max clamped */}
      {/* biome-ignore lint/a11y/useSemanticElements: div separator needed for drag handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={leftWidth}
        aria-valuemin={minLeft}
        aria-valuemax={9999}
        tabIndex={0}
        onMouseDown={onMouseDown}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 50 : 10;
          if (e.key === "ArrowLeft") setLeftWidth((w) => Math.max(minLeft, w - step));
          else if (e.key === "ArrowRight") setLeftWidth((w) => w + step);
        }}
        className="group relative z-10 flex w-[5px] shrink-0 cursor-col-resize items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <div className="h-full w-px bg-border transition-colors group-hover:bg-accent group-active:bg-accent" />
        <div className="absolute flex h-8 w-[5px] items-center justify-center opacity-0 group-hover:opacity-100 group-active:opacity-100">
          <div className="h-4 w-[3px] rounded-full bg-accent" />
        </div>
      </div>

      {/* Right panel */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{right}</div>
    </div>
  );
}
