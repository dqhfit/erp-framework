import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { useIsMobile } from "@/hooks/useMediaQuery";

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
  isLeftCollapsed?: boolean;
  onLeftCollapseChange?: (collapsed: boolean) => void;
  isRightCollapsed?: boolean;
  onRightCollapseChange?: (collapsed: boolean) => void;
  collapsible?: boolean;
}

export function SplitPane({
  left,
  right,
  defaultLeftWidth = 420,
  minLeft = 200,
  minRight = 240,
  storageKey,
  className = "",
  isLeftCollapsed,
  onLeftCollapseChange,
  isRightCollapsed,
  onRightCollapseChange,
  collapsible = false,
}: SplitPaneProps) {
  const isMobile = useIsMobile();
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved) return Number(saved);
    }
    return defaultLeftWidth;
  });
  const [isDragging, setIsDragging] = useState(false);
  const [containerWidth, setContainerWidth] = useState(1200);

  const enableCollapse =
    collapsible || isLeftCollapsed !== undefined || isRightCollapsed !== undefined;

  const [internalLeftCollapsed, setInternalLeftCollapsed] = useState(false);
  const [internalRightCollapsed, setInternalRightCollapsed] = useState(false);

  const leftCollapsed = enableCollapse
    ? isLeftCollapsed !== undefined
      ? isLeftCollapsed
      : internalLeftCollapsed
    : false;
  const rightCollapsed = enableCollapse
    ? isRightCollapsed !== undefined
      ? isRightCollapsed
      : internalRightCollapsed
    : false;

  const handleLeftCollapse = useCallback(
    (val: boolean) => {
      if (!enableCollapse) return;
      onLeftCollapseChange?.(val);
      if (isLeftCollapsed === undefined) {
        setInternalLeftCollapsed(val);
      }
    },
    [onLeftCollapseChange, isLeftCollapsed, enableCollapse],
  );

  const handleRightCollapse = useCallback(
    (val: boolean) => {
      if (!enableCollapse) return;
      onRightCollapseChange?.(val);
      if (isRightCollapsed === undefined) {
        setInternalRightCollapsed(val);
      }
    },
    [onRightCollapseChange, isRightCollapsed, enableCollapse],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  // Measure container width for pixel-perfect slide transitions
  useEffect(() => {
    if (!enableCollapse || !containerRef.current) return;
    setContainerWidth(containerRef.current.offsetWidth);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [enableCollapse]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (leftCollapsed || rightCollapsed) return;
      e.preventDefault();
      dragging.current = true;
      setIsDragging(true);
      startX.current = e.clientX;
      startWidth.current = leftWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [leftWidth, leftCollapsed, rightCollapsed],
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
      setIsDragging(false);
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

  // Mobile: bỏ split ngang + drag → xếp chồng dọc, mỗi panel cuộn riêng.
  if (isMobile) {
    return (
      <div className={`flex min-h-0 flex-1 flex-col gap-0 overflow-auto ${className}`}>
        <div className="flex min-h-0 flex-col overflow-hidden border-b border-border">{left}</div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{right}</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`flex min-h-0 flex-1 gap-0 relative overflow-hidden ${className}`}
    >
      {/* Overlay to prevent iframe mouse event capturing during drag */}
      {isDragging && (
        <div
          className="fixed inset-0 z-50 cursor-col-resize pointer-events-auto"
          style={{ background: "transparent" }}
        />
      )}
      {/* Left panel */}
      <div
        className="flex min-h-0 flex-col overflow-hidden"
        style={
          enableCollapse
            ? {
                width: leftCollapsed ? 0 : rightCollapsed ? containerWidth : leftWidth,
                minWidth: leftCollapsed ? 0 : rightCollapsed ? containerWidth : minLeft,
                flex: "none",
                visibility: leftCollapsed ? "hidden" : "visible",
                transition: isDragging
                  ? "none"
                  : "width 300ms cubic-bezier(0.4, 0, 0.2, 1), min-width 300ms cubic-bezier(0.4, 0, 0.2, 1), visibility 300ms",
              }
            : {
                width: leftWidth,
                minWidth: minLeft,
              }
        }
      >
        {left}
      </div>

      {/* Drag handle — keyboard: ←/→ resize, min/max clamped */}
      {/* biome-ignore lint/a11y/useSemanticElements: div separator needed for drag handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={leftCollapsed ? 0 : leftWidth}
        aria-valuemin={leftCollapsed ? 0 : minLeft}
        aria-valuemax={9999}
        tabIndex={0}
        onMouseDown={onMouseDown}
        onDoubleClick={
          enableCollapse
            ? (e) => {
                e.preventDefault();
                handleLeftCollapse(!leftCollapsed);
              }
            : undefined
        }
        onKeyDown={(e) => {
          if (leftCollapsed || rightCollapsed) return;
          const step = e.shiftKey ? 50 : 10;
          if (e.key === "ArrowLeft") setLeftWidth((w) => Math.max(minLeft, w - step));
          else if (e.key === "ArrowRight") setLeftWidth((w) => w + step);
        }}
        className={`group relative z-10 flex w-[5px] shrink-0 items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          leftCollapsed || rightCollapsed ? "cursor-default" : "cursor-col-resize"
        }`}
      >
        <div className="h-full w-px bg-border transition-colors group-hover:bg-accent group-active:bg-accent" />

        {/* Subtle drag dot indicators */}
        {!leftCollapsed && !rightCollapsed && (
          <div className="absolute flex h-8 w-[5px] items-center justify-center opacity-0 group-hover:opacity-100 group-active:opacity-100">
            <div className="h-4 w-[3px] rounded-full bg-accent" />
          </div>
        )}

        {/* Collapse Left Button (Floating) */}
        {enableCollapse && !rightCollapsed && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleLeftCollapse(!leftCollapsed);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className={`absolute z-20 flex h-6 w-4 items-center justify-center border border-border bg-panel text-text shadow-md hover:shadow-lg hover:scale-110 active:scale-95 transition-all duration-200 group/btn ${
              leftCollapsed ? "rounded-r" : "rounded"
            }`}
            style={{
              top: "40%",
              left: leftCollapsed ? "0px" : "50%",
              transform: leftCollapsed ? "translateY(-50%)" : "translate(-50%, -50%)",
            }}
            title={leftCollapsed ? "Mở rộng danh sách" : "Thu gọn danh sách"}
          >
            <div
              className={`transition-transform duration-200 group-active/btn:scale-90 group-hover/btn:${
                leftCollapsed ? "translate-x-0.5" : "-translate-x-0.5"
              }`}
            >
              {leftCollapsed ? <I.ChevronRight size={10} /> : <I.ChevronLeft size={10} />}
            </div>
          </button>
        )}

        {/* Collapse Right Button (Floating) */}
        {enableCollapse && !leftCollapsed && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleRightCollapse(!rightCollapsed);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className={`absolute z-20 flex h-6 w-4 items-center justify-center border border-border bg-panel text-text shadow-md hover:shadow-lg hover:scale-110 active:scale-95 transition-all duration-200 group/btn ${
              rightCollapsed ? "rounded-l" : "rounded"
            }`}
            style={{
              top: "60%",
              left: rightCollapsed ? "auto" : "50%",
              right: rightCollapsed ? "0px" : "auto",
              transform: rightCollapsed ? "translateY(-50%)" : "translate(-50%, -50%)",
            }}
            title={rightCollapsed ? "Mở rộng PDF" : "Thu gọn PDF"}
          >
            <div
              className={`transition-transform duration-200 group-active/btn:scale-90 group-hover/btn:${
                rightCollapsed ? "-translate-x-0.5" : "translate-x-0.5"
              }`}
            >
              {rightCollapsed ? <I.ChevronLeft size={10} /> : <I.ChevronRight size={10} />}
            </div>
          </button>
        )}
      </div>

      {/* Right panel */}
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        style={
          enableCollapse
            ? {
                width: rightCollapsed
                  ? 0
                  : leftCollapsed
                    ? containerWidth
                    : containerWidth - leftWidth,
                minWidth: rightCollapsed ? 0 : leftCollapsed ? containerWidth : minRight,
                flex: "none",
                visibility: rightCollapsed ? "hidden" : "visible",
                transition: isDragging
                  ? "none"
                  : "width 300ms cubic-bezier(0.4, 0, 0.2, 1), min-width 300ms cubic-bezier(0.4, 0, 0.2, 1), visibility 300ms",
              }
            : undefined
        }
      >
        {right}
      </div>
    </div>
  );
}
