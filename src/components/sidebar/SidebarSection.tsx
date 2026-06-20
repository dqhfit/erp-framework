/* SidebarSection — section gập/mở của sidebar (Home/Đối tượng/Trang…),
   hỗ trợ kéo-thả gộp nhóm + sub-menu. Tách từ Sidebar.tsx. */
import { useState } from "react";
import { I } from "@/components/Icons";
import { SidebarItem } from "@/components/sidebar/SidebarItem";
import { useGroupState } from "@/components/sidebar/useGroupState";
import { useT } from "@/hooks/useT";
import type { IconName } from "@/lib/object-types";
import { cn } from "@/lib/utils";

/* ─── SidebarSection ──────────────────────────────────────── */
export interface SectionItem {
  id: string;
  name: string;
  iconName: IconName;
  to: string;
  badge?: string;
  /** True nếu là user-created → cho phép xóa/rename/drag */
  userOwned?: boolean;
  isFav?: boolean;
  onFavorite?: () => void;
}
export interface SectionProps {
  title: string;
  collapsed: boolean;
  items: SectionItem[];
  pathname: string;
  open: boolean;
  onToggle: () => void;
  onAdd?: () => void;
  onAiAdd?: () => void;
  onDelete?: (id: string) => void;
  onRename?: (id: string, newName: string) => void;
  /** Khi set, bật sub-menu DnD và persist group state với key này */
  sectionKey?: string;
  /** Callback khi user click vào bất kỳ item nào — thu gọn group khác */
  onNavigate?: () => void;
  /** Nút extra hiện trước + trong section header */
  extraButtons?: React.ReactNode;
}
export function SidebarSection({
  title,
  collapsed,
  items,
  pathname,
  open,
  onToggle,
  onAdd,
  onAiAdd,
  onDelete,
  onRename,
  sectionKey,
  onNavigate,
  extraButtons,
}: SectionProps) {
  const t = useT();
  const { gs, nestUnder, unnest, toggleExpanded } = useGroupState(sectionKey);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverHeader, setDragOverHeader] = useState(false);

  // DnD chỉ hoạt động khi có sectionKey và không thu nhỏ
  const canGroup = !!sectionKey && !collapsed;

  // Tính toán cấu trúc nhóm — lọc id lỗi thời ngay tại render
  const validIds = new Set(items.map((i) => i.id));
  const parents: Record<string, string> = sectionKey
    ? Object.fromEntries(
        Object.entries(gs.parents).filter(([k, v]) => validIds.has(k) && validIds.has(v)),
      )
    : {};
  const groupHeaders = new Set(Object.values(parents));
  const isOpen = (id: string) => gs.expanded[id] !== false; // undefined = open
  const topLevel = items.filter((i) => !parents[i.id]);

  /* ── DnD handlers ── */
  const startDrag = (e: React.DragEvent<HTMLDivElement>, id: string) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };
  const endDrag = () => {
    setDraggingId(null);
    setDragOverId(null);
    setDragOverHeader(false);
  };

  const onItemDragOver = (e: React.DragEvent<HTMLDivElement>, targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    const dragIsChild = !!parents[draggingId];
    const targetIsChild = !!parents[targetId];
    if (dragIsChild && targetIsChild) return; // không cho nest 2 cấp
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(targetId);
    setDragOverHeader(false);
  };

  const onItemDrop = (e: React.DragEvent<HTMLDivElement>, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggingId || draggingId === targetId) {
      endDrag();
      return;
    }
    const dragIsChild = !!parents[draggingId];
    const targetIsChild = !!parents[targetId];
    if (dragIsChild && targetIsChild) {
      endDrag();
      return;
    }
    // top→top: nest drag dưới target. child→top/header: chuyển nhóm.
    nestUnder(draggingId, targetId);
    endDrag();
  };

  const onSectionHeaderDragOver = (e: React.DragEvent) => {
    // Chỉ sub-item mới có thể bỏ nhóm bằng cách thả lên section header
    if (!draggingId || !parents[draggingId]) return;
    e.preventDefault();
    setDragOverHeader(true);
    setDragOverId(null);
  };
  const onSectionHeaderDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (draggingId && parents[draggingId]) unnest(draggingId);
    endDrag();
  };

  /* ── Render một item (và children nếu là group header) ── */
  const renderItem = (item: SectionItem, opts?: { indent?: boolean }) => {
    const IconC = I[item.iconName] || I.Folder;
    const isHeader = !collapsed && groupHeaders.has(item.id);
    const children = isHeader ? items.filter((c) => parents[c.id] === item.id) : [];
    // Group header không được kéo (tránh nest 2 cấp)
    const isDraggableItem = canGroup && !!item.userOwned && !isHeader;
    return (
      <div key={item.id}>
        <SidebarItem
          to={item.to}
          active={pathname === item.to}
          icon={<IconC size={14} />}
          collapsed={collapsed}
          label={item.name}
          badge={item.badge}
          indent={opts?.indent}
          isGroupHeader={isHeader}
          isExpanded={isOpen(item.id)}
          onToggleExpanded={isHeader ? () => toggleExpanded(item.id) : undefined}
          isDragTarget={dragOverId === item.id}
          draggable={isDraggableItem}
          onDragStart={isDraggableItem ? (e) => startDrag(e, item.id) : undefined}
          onDragEnd={isDraggableItem ? endDrag : undefined}
          onDragOver={canGroup ? (e) => onItemDragOver(e, item.id) : undefined}
          onDragLeave={canGroup ? () => setDragOverId(null) : undefined}
          onDrop={canGroup ? (e) => onItemDrop(e, item.id) : undefined}
          onToggleFavorite={item.onFavorite}
          isFavorited={item.isFav}
          onDelete={item.userOwned && onDelete ? () => onDelete(item.id) : undefined}
          onRename={
            item.userOwned && onRename ? (newName) => onRename(item.id, newName) : undefined
          }
          onNavigate={onNavigate}
        />
        {/* Children của group header */}
        {isHeader && isOpen(item.id) && children.map((c) => renderItem(c, { indent: true }))}
      </div>
    );
  };

  return (
    <div className={cn("mb-1.5", !collapsed && !open && "mb-0")}>
      {/* Section header khi đang đóng */}
      {!collapsed && !open && (
        <button
          type="button"
          onClick={onToggle}
          className="w-full flex items-center gap-1 px-3 py-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase text-muted/40 hover:text-muted transition-colors"
        >
          <I.ChevronRight size={10} className="shrink-0" />
          <span className="truncate">{title}</span>
        </button>
      )}
      {/* Section header khi đang mở — cũng là drop zone để bỏ nhóm */}
      {!collapsed && open && (
        <div
          className={cn(
            "flex items-center justify-between px-3 mt-3 mb-1 rounded",
            dragOverHeader && "ring-1 ring-dashed ring-accent/60 bg-accent/5",
          )}
          onDragOver={canGroup ? onSectionHeaderDragOver : undefined}
          onDragLeave={canGroup ? () => setDragOverHeader(false) : undefined}
          onDrop={canGroup ? onSectionHeaderDrop : undefined}
        >
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-1 text-[10px] font-semibold tracking-[0.08em] uppercase text-muted hover:text-text min-w-0"
          >
            <I.ChevronRight size={10} className="transition-transform shrink-0 rotate-90" />
            <span className="truncate">{title}</span>
          </button>
          <div className="flex items-center gap-0.5 shrink-0">
            {dragOverHeader && (
              <span className="text-[9px] text-accent/70 mr-1">{t("sidebar.ungroup")}</span>
            )}
            {extraButtons}
            {onAiAdd && (
              <button
                type="button"
                onClick={onAiAdd}
                className="w-5 h-5 rounded-sm hover:bg-accent/20 flex items-center justify-center text-accent hover:text-accent"
                title={t("sidebar.add_ai", { kind: title.toLowerCase() })}
              >
                <I.Sparkles size={11} />
              </button>
            )}
            <button
              type="button"
              onClick={onAdd}
              disabled={!onAdd}
              className="w-5 h-5 rounded-sm hover:bg-hover/60 flex items-center justify-center text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
              title={t("sidebar.add_blank", { kind: title.toLowerCase() })}
            >
              <I.Plus size={12} />
            </button>
          </div>
        </div>
      )}
      {/* Items: khi thu nhỏ hiện phẳng, khi mở hiện theo cấu trúc nhóm */}
      {collapsed && items.map((item) => renderItem(item))}
      {!collapsed && open && topLevel.map((item) => renderItem(item))}
    </div>
  );
}
