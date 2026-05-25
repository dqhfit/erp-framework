import { useId, type ReactNode } from "react";
import { Button } from "./button";
import { I } from "../Icons";
import { useFocusTrap } from "@/hooks/useFocusTrap";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  width?: number;
  children?: ReactNode;
  footer?: ReactNode;
}
export function Drawer({ open, onClose, title, width = 420, children, footer }: DrawerProps) {
  // Focus trap + Esc + return focus về trigger (giống Modal).
  const containerRef = useFocusTrap<HTMLDivElement>(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[800]" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute top-0 right-0 h-full panel border-l border-border shadow-2xl flex flex-col outline-none"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3 border-b border-border h-12 shrink-0">
          <div id={titleId} className="font-semibold">{title}</div>
          <Button variant="ghost" size="sm" onClick={onClose} icon={<I.X size={14} />} />
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="p-3 border-t border-border">{footer}</div>}
      </div>
    </div>
  );
}
