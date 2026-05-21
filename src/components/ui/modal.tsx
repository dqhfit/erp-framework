import { useEffect, type ReactNode } from "react";
import { Button } from "./button";
import { I } from "../Icons";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  width?: number;
  children?: ReactNode;
  footer?: ReactNode;
}
export function Modal({ open, onClose, title, width = 480, children, footer }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[900] flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />
      <div
        className="relative panel rounded-lg shadow-2xl flex flex-col max-h-[90vh]"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="font-semibold text-lg">{title}</div>
          <Button variant="ghost" size="sm" onClick={onClose} icon={<I.X size={14} />} />
        </div>
        <div className="p-4 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="p-3 border-t border-border flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
