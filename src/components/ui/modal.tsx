import { type ReactNode, useId } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { cn } from "@/lib/utils";
import { I } from "../Icons";
import { Button } from "./button";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  width?: number;
  children?: ReactNode;
  footer?: ReactNode;
  /** Vị trí dọc: "center" (mặc định) hoặc "top" (sát ngay dưới header). */
  align?: "center" | "top";
}
export function Modal({
  open,
  onClose,
  title,
  width = 480,
  children,
  footer,
  align = "center",
}: ModalProps) {
  const containerRef = useFocusTrap<HTMLDivElement>(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-900 overflow-y-auto">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] pointer-events-none" />
      <div
        className={cn(
          "flex min-h-full justify-center px-2 pb-4 sm:px-4",
          align === "top" ? "items-start pt-14" : "items-center pt-2 sm:pt-4",
        )}
      >
        <div
          ref={containerRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={cn(
            "relative panel rounded-lg shadow-2xl flex flex-col overflow-hidden w-full outline-hidden",
            align === "top" ? "max-h-[calc(100vh-4.5rem)]" : "max-h-[calc(100vh-2rem)]",
          )}
          style={{ maxWidth: width }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
            <div id={titleId} className="font-semibold text-lg">
              {title}
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} icon={<I.X size={14} />} />
          </div>
          <div className="p-4 overflow-y-auto flex-1 min-h-0">{children}</div>
          {footer && (
            <div className="p-3 border-t border-border flex items-center justify-end gap-2 shrink-0">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
