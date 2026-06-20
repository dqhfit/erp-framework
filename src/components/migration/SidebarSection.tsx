/* SidebarSection — panel gập/mở có nhớ trạng thái vào localStorage.
   Dùng chung trong settings.migration + các screen migration. */
import { type ReactNode, useState } from "react";
import { I } from "@/components/Icons";

export function SidebarSection({
  storageKey,
  title,
  actions,
  children,
  defaultOpen = true,
}: {
  storageKey: string;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(() => {
    try {
      const v = window.localStorage.getItem(storageKey);
      return v == null ? defaultOpen : v === "1";
    } catch {
      return defaultOpen;
    }
  });
  const toggle = () =>
    setOpen((v) => {
      const next = !v;
      window.localStorage.setItem(storageKey, next ? "1" : "0");
      return next;
    });
  return (
    <div className="border-b border-border">
      {/* biome-ignore lint/a11y/useSemanticElements: header custom chứa nút action lồng bên trong, không dùng <button> thật được */}
      <div
        className="flex items-center gap-1 px-3 py-2 bg-surface/50 cursor-pointer select-none"
        onClick={toggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && toggle()}
      >
        {open ? (
          <I.ChevronDown size={12} className="shrink-0 text-muted" />
        ) : (
          <I.ChevronRight size={12} className="shrink-0 text-muted" />
        )}
        <span className="flex-1 text-sm font-semibold">{title}</span>
        {actions && (
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className="flex gap-1"
          >
            {actions}
          </div>
        )}
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}
