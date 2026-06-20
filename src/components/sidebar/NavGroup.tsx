/* NavGroup — nhóm điều hướng gọn lại (tiêu đề bấm mở/đóng). Tách từ Sidebar.tsx. */
import type { ReactNode } from "react";
import { I } from "@/components/Icons";
import { useT } from "@/hooks/useT";
import { cn } from "@/lib/utils";

/* Nhóm điều hướng GỌN LẠI — tiêu đề bấm để mở/đóng. Khi sidebar
   ở chế độ thu nhỏ (icon-only) thì bỏ tiêu đề, hiện thẳng item. */
export function NavGroup({
  title,
  collapsed,
  open,
  onToggle,
  children,
  scrollCap,
}: {
  title: string;
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Giới hạn chiều cao nội dung nhóm ≤ 50% màn hình + tự cuộn (nhóm dài như Vận hành/Cấu hình). */
  scrollCap?: boolean;
}) {
  const t = useT();
  if (collapsed) return <>{children}</>;
  return (
    <div className="mb-0.5">
      <div className="flex items-center justify-between px-3 mt-2.5 mb-1">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-1 text-[10px] font-semibold tracking-[0.08em] uppercase text-muted hover:text-text min-w-0"
        >
          <I.ChevronRight
            size={10}
            className={cn("transition-transform shrink-0", open && "rotate-90")}
          />
          <span className="truncate">{title}</span>
        </button>
        <button
          type="button"
          onClick={onToggle}
          title={open ? t("sidebar.collapse") : t("sidebar.expand")}
          className="w-5 h-5 rounded-sm hover:bg-hover/60 flex items-center justify-center text-muted/50 hover:text-text transition-colors shrink-0"
        >
          <I.ChevronsUpDown size={11} />
        </button>
      </div>
      {open && <div className={cn(scrollCap && "max-h-[50vh] overflow-y-auto")}>{children}</div>}
    </div>
  );
}
