/* SidebarItem — 1 mục điều hướng trong sidebar: icon + nhãn, active state,
   nút ghim/đổi tên/xoá, drag-drop gộp nhóm. Tách từ Sidebar.tsx. */
import { Link } from "@tanstack/react-router";
import { type ReactNode, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { useT } from "@/hooks/useT";
import { cn } from "@/lib/utils";

export interface SidebarItemProps {
  to: string;
  active: boolean;
  icon: ReactNode;
  collapsed: boolean;
  label: string;
  badge?: string;
  title?: string;
  onDelete?: () => void;
  onRename?: (newName: string) => void;
  /** Ghim vào danh sách yêu thích */
  isFavorited?: boolean;
  onToggleFavorite?: () => void;
  /** Sub-item indent */
  indent?: boolean;
  /** Group header — shows expand/collapse chevron */
  isGroupHeader?: boolean;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
  /** Highlight as drop target */
  isDragTarget?: boolean;
  /** HTML5 drag-and-drop */
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: React.DragEvent<HTMLDivElement>) => void;
  /** Callback khi user click navigate — dùng để thu gọn các group khác */
  onNavigate?: () => void;
}
export function SidebarItem({
  to,
  active,
  icon,
  collapsed,
  label,
  badge,
  title,
  onDelete,
  onRename,
  isFavorited,
  onToggleFavorite,
  indent,
  isGroupHeader,
  isExpanded,
  onToggleExpanded,
  isDragTarget,
  draggable: isDraggable,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onDragLeave,
  onNavigate,
}: SidebarItemProps) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasActions = !collapsed && (onDelete || onRename || onToggleFavorite);
  // Caret mở/đóng nhóm đặt CUỐI dòng, luôn hiển thị cho group header.
  const showCaret = !!isGroupHeader && !collapsed;
  // Right padding: 20px mỗi nút action (hiện khi hover) + caret (luôn hiện).
  const actionCount = [onToggleFavorite, isDraggable, onRename, onDelete].filter(Boolean).length;
  const rightUnits = actionCount + (showCaret ? 1 : 0);
  const rightPr = rightUnits > 0 ? rightUnits * 20 + 8 : undefined;

  const commit = () => {
    const next = inputRef.current?.value.trim();
    if (next && next !== label) onRename?.(next);
    setEditing(false);
  };

  if (editing && !collapsed) {
    return (
      <div
        className={cn("relative group", indent && !collapsed && "pl-4")}
        draggable={isDraggable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragLeave={onDragLeave}
      >
        <div className={cn("sidebar-item", active && "active")}>
          <span className="icon text-muted shrink-0">{icon}</span>
          <input
            ref={inputRef}
            defaultValue={label}
            // biome-ignore lint/a11y/noAutofocus: input rename xuất hiện đúng lúc user bấm đổi tên, cần focus ngay để gõ
            autoFocus
            className="flex-1 bg-transparent outline-none text-[13px] min-w-0 leading-none"
            onFocus={(e) => e.currentTarget.select()}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
              if (e.key === "Escape") setEditing(false);
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative group",
        indent && !collapsed && "pl-4",
        isDragTarget && !collapsed && "mx-1 rounded-md ring-1 ring-accent/40 bg-accent/5",
      )}
      draggable={isDraggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
      onDoubleClick={onRename && !collapsed ? () => setEditing(true) : undefined}
    >
      <Link
        to={to}
        className={cn("sidebar-item", active && "active", showCaret && "font-medium bg-bg-soft/40")}
        style={rightPr ? { paddingRight: rightPr } : undefined}
        title={title ?? label}
        onClick={onNavigate}
      >
        <span className="icon text-muted shrink-0">{icon}</span>
        {!collapsed && (
          <>
            <span className="truncate flex-1">{label}</span>
            {badge && (
              <span className="chip" style={{ height: 16, fontSize: 10, padding: "0 5px" }}>
                {badge}
              </span>
            )}
          </>
        )}
      </Link>
      {(hasActions || showCaret) && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {hasActions && (
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              {onToggleFavorite && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onToggleFavorite();
                  }}
                  className={cn(
                    "w-5 h-5 rounded-sm flex items-center justify-center transition-colors",
                    isFavorited
                      ? "text-warning hover:brightness-110"
                      : "text-muted/40 hover:bg-hover/80 hover:text-warning",
                  )}
                  title={isFavorited ? t("sidebar.remove_favorite") : t("sidebar.add_favorite")}
                >
                  <I.Star size={11} />
                </button>
              )}
              {isDraggable && (
                <span
                  className="w-5 h-5 flex items-center justify-center text-muted/30 cursor-grab"
                  title={t("sidebar.drag_to_group")}
                >
                  <I.Grip size={10} />
                </span>
              )}
              {onRename && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditing(true);
                  }}
                  className="w-5 h-5 rounded-sm hover:bg-hover/80 flex items-center justify-center text-muted hover:text-text"
                  title={t("common.rename")}
                >
                  <I.Edit size={11} />
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDelete();
                  }}
                  className="w-5 h-5 rounded-sm hover:bg-danger/20 flex items-center justify-center text-muted hover:text-danger"
                  title={t("common.delete")}
                >
                  <I.Trash size={11} />
                </button>
              )}
            </div>
          )}
          {/* Caret mở/đóng nhóm — luôn hiện cho group header, đặt ngoài cùng phải */}
          {showCaret && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleExpanded?.();
              }}
              className="w-5 h-5 rounded-sm flex items-center justify-center text-muted/60 hover:text-text hover:bg-hover/60 transition-colors"
              aria-label={isExpanded ? t("sidebar.collapse_group") : t("sidebar.expand_group")}
            >
              <I.ChevronRight
                size={11}
                className={cn("transition-transform", isExpanded && "rotate-90")}
              />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
