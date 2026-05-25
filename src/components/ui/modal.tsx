import { useFocusTrap } from "@/hooks/useFocusTrap";
import { type ReactNode, useId } from "react";
import { I } from "../Icons";
import { Button } from "./button";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  width?: number;
  children?: ReactNode;
  footer?: ReactNode;
}
export function Modal({ open, onClose, title, width = 480, children, footer }: ModalProps) {
  // Hook gom Escape + Tab/Shift+Tab trap + return focus về trigger.
  const containerRef = useFocusTrap<HTMLDivElement>(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[900] overflow-y-auto"
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] pointer-events-none" />
      <div className="flex min-h-full items-center justify-center p-4">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative panel rounded-lg shadow-2xl flex flex-col max-h-[calc(100vh-2rem)] overflow-hidden w-full outline-none"
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
    </div>
  );
}
