import { createLegacyMenuClient } from "@erp-framework/client";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AssignPageToMenuModal } from "@/components/AssignPageToMenuModal";
import { I } from "@/components/Icons";
import { MenuTree, type MenuTreeHandle, type NavNode } from "@/components/MenuTree";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useT } from "@/hooks/useT";
import { dialog } from "@/lib/dialog";
import type { IconName } from "@/lib/object-types";
import { type ObjectType, roleCan } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { usePreferences } from "@/stores/preferences";
import { useRbac } from "@/stores/rbac";
import { useUI } from "@/stores/ui";
import { useUserObjects } from "@/stores/userObjects";

/* ─── Sub-menu group state (persisted to localStorage) ───── */
interface GroupState {
  parents: Record<string, string>; // childId → parentId
  expanded: Record<string, boolean>; // parentId → open flag (missing = open)
}
const _eGs: GroupState = { parents: {}, expanded: {} };

function _loadGs(k: string): GroupState {
  try {
    const r = localStorage.getItem(`sb-grp-${k}`);
    return r ? (JSON.parse(r) as GroupState) : _eGs;
  } catch {
    return _eGs;
  }
}
function _saveGs(k: string, g: GroupState) {
  try {
    localStorage.setItem(`sb-grp-${k}`, JSON.stringify(g));
  } catch {}
}
function useGroupState(key?: string) {
  const [gs, _set] = useState<GroupState>(() => (key ? _loadGs(key) : _eGs));
  const set = (next: GroupState) => {
    _set(next);
    if (key) _saveGs(key, next);
  };
  return {
    gs,
    nestUnder: (child: string, parent: string) =>
      set({
        parents: { ...gs.parents, [child]: parent },
        expanded: { ...gs.expanded, [parent]: true },
      }),
    unnest: (child: string) => {
      const p = { ...gs.parents };
      delete p[child];
      set({ ...gs, parents: p });
    },
    toggleExpanded: (id: string) =>
      set({ ...gs, expanded: { ...gs.expanded, [id]: !(gs.expanded[id] ?? true) } }),
  };
}

/* ─── Favorites (yêu thích) ────────────────────────────────── */
// FavItem tái sử dụng SidebarFavItem từ preferences store để đảm bảo
// cùng shape khi lưu/đọc từ server.
import type { SidebarFavItem } from "@/stores/preferences";

type FavItem = SidebarFavItem;

export function useFavs() {
  const prefs = usePreferences((s) => s.prefs);
  const savePrefs = usePreferences((s) => s.save);
  const loaded = usePreferences((s) => s.loaded);

  // localStorage làm cache tạm để render ngay trước khi server phản hồi
  const [favs, setFavs] = useState<FavItem[]>(() => {
    try {
      const r = localStorage.getItem("sb-favs");
      return r ? (JSON.parse(r) as FavItem[]) : [];
    } catch {
      return [];
    }
  });
  const [serverApplied, setServerApplied] = useState(false);

  // Khi prefs tải xong từ server: server thắng → override localStorage
  useEffect(() => {
    if (!loaded || serverApplied) return;
    const serverFavs = (prefs.sidebarFavorites as FavItem[] | undefined) ?? [];
    setFavs(serverFavs);
    setServerApplied(true);
    try {
      localStorage.setItem("sb-favs", JSON.stringify(serverFavs));
    } catch {}
  }, [loaded, serverApplied, prefs.sidebarFavorites]);

  const save = (next: FavItem[]) => {
    setFavs(next);
    try {
      localStorage.setItem("sb-favs", JSON.stringify(next));
    } catch {}
    // Debounce 800ms ghi lên server (qua preferences store)
    savePrefs({ sidebarFavorites: next });
  };

  return {
    favs,
    isFav: (id: string) => favs.some((f) => f.id === id),
    toggle: (item: FavItem) =>
      save(
        favs.some((f) => f.id === item.id) ? favs.filter((f) => f.id !== item.id) : [...favs, item],
      ),
    remove: (id: string) => save(favs.filter((f) => f.id !== id)),
  };
}

/* ─── SidebarItem ─────────────────────────────────────────── */
interface SidebarItemProps {
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
function SidebarItem({
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

/* ─── SidebarSection ──────────────────────────────────────── */
interface SectionItem {
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
interface SectionProps {
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
function SidebarSection({
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

/* ─── FavoritesSection — danh sách yêu thích dưới Home ─────── */
function FavoritesSection({
  favs,
  onRemove,
  pathname,
  collapsed,
}: {
  favs: FavItem[];
  onRemove: (id: string) => void;
  pathname: string;
  collapsed: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem("sb-favs-open") !== "false";
    } catch {
      return true;
    }
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem("sb-favs-open", String(next));
    } catch {}
  };

  if (favs.length === 0) return null;

  return (
    <div className="border-b border-border/40 pb-0.5">
      {!collapsed && (
        <button
          type="button"
          onClick={toggle}
          className="w-full flex items-center gap-1 px-3 pt-2 pb-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase text-muted/50 hover:text-muted transition-colors"
        >
          <I.ChevronRight
            size={9}
            className={cn("transition-transform shrink-0", open && "rotate-90")}
          />
          <I.Star size={9} className="shrink-0 text-warning/70" />
          <span>{t("sidebar.favorites")}</span>
        </button>
      )}
      {(collapsed || open) &&
        favs.map((fav) => {
          const IconC = (I[fav.iconName as IconName] ?? I.Star) as React.ComponentType<{
            size: number;
          }>;
          return (
            <div key={fav.id} className={cn("relative group", !collapsed && "pl-3")}>
              <Link
                to={fav.to}
                className={cn(
                  "sidebar-item",
                  pathname === fav.to && "active",
                  !collapsed && "pr-7",
                )}
                title={fav.label}
              >
                <span className="icon text-muted shrink-0">
                  <IconC size={14} />
                </span>
                {!collapsed && <span className="truncate flex-1 text-[13px]">{fav.label}</span>}
              </Link>
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => onRemove(fav.id)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-sm flex items-center justify-center text-muted/30 hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
                  title={t("sidebar.remove_favorite")}
                >
                  <I.X size={10} />
                </button>
              )}
            </div>
          );
        })}
    </div>
  );
}

/* ─── PagesTreeSection — điều hướng TRANG theo CÂY MENU DQHF ───────
   Admin/editor: cây menu (legacy_menu_map.navTree) cho trang đã gắn +
   nhóm "Chưa gắn menu" cho trang lẻ (vẫn quản lý/xóa được). Lá click →
   mở /pages/<id>. Khi sidebar thu nhỏ thì ẩn (cây cần bề ngang). */
function PagesTreeSection({
  collapsed,
  pathname,
  open,
  onToggle,
  onAdd,
  onAiAdd,
  onNavigate,
  navNodes,
  orphanPages,
  allPages,
  onOpen,
  onDeletePage,
  onAssignPage,
}: {
  collapsed: boolean;
  pathname: string;
  open: boolean;
  onToggle: () => void;
  onAdd?: () => void;
  onAiAdd?: () => void;
  onNavigate?: () => void;
  navNodes: NavNode[];
  orphanPages: Array<{ id: string; name: string; icon: IconName; to: string }>;
  /** Toàn bộ trang (gắn + chưa gắn menu) để lọc khi tìm kiếm. */
  allPages: Array<{ id: string; name: string; icon: IconName; to: string }>;
  onOpen: (to: string) => void;
  onDeletePage?: (id: string) => void;
  /** Gán 1 trang lẻ (chưa gắn menu) vào 1 mục menu DQHF. */
  onAssignPage?: (page: { id: string; name: string }) => void;
}) {
  const t = useT();
  // Trang đang xem suy ra từ route /pages/<id> hoặc /view/<id>.
  const matched = pathname.match(/^\/(?:pages|view)\/([^/]+)/);
  const activePageId = matched?.[1] ?? null;
  // Tìm kiếm trang trong menu — toggle icon → input inline (giống ô tìm
  // kiếm ở "Trang chủ"). Có query → hiện danh sách phẳng đã lọc thay cây.
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  // Tìm kiếm CỤC BỘ trong nhóm "Chưa gắn menu" — chỉ lọc trang lẻ của nhóm đó.
  const [orphanSearchOpen, setOrphanSearchOpen] = useState(false);
  const [orphanQ, setOrphanQ] = useState("");
  const orphanSearchRef = useRef<HTMLInputElement>(null);
  // Thu gọn nhóm "Chưa gắn menu" + cô lập (ẩn cây menu, chỉ hiện nhóm này).
  const [orphanCollapsed, setOrphanCollapsed] = useState(false);
  const [orphanIsolated, setOrphanIsolated] = useState(false);
  // Ref điều khiển mở rộng / thu gọn tất cả nhánh cây menu trang (admin/editor).
  const menuTreeRef = useRef<MenuTreeHandle>(null);
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);
  useEffect(() => {
    if (orphanSearchOpen) orphanSearchRef.current?.focus();
  }, [orphanSearchOpen]);
  const closeSearch = () => {
    setSearchOpen(false);
    setQ("");
  };
  if (collapsed) return null;
  const kind = t("sidebar.pages").toLowerCase();
  const ql = q.trim().toLowerCase();
  const results = ql ? allPages.filter((p) => p.name.toLowerCase().includes(ql)) : [];
  const oql = orphanQ.trim().toLowerCase();
  const orphanFiltered = oql
    ? orphanPages.filter((p) => p.name.toLowerCase().includes(oql))
    : orphanPages;
  return (
    <div className="border-b border-border/40 pb-1">
      <div className="group/sec flex items-center px-3 pt-2 pb-0.5">
        {searchOpen ? (
          <>
            <I.Search size={11} className="shrink-0 text-muted" />
            <input
              ref={searchRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeSearch();
              }}
              placeholder={t("sidebar.search")}
              className="flex-1 bg-transparent outline-none text-[12px] text-text placeholder:text-muted/50 min-w-0 ml-1.5"
            />
            <button
              type="button"
              onClick={closeSearch}
              className="w-5 h-5 rounded-sm flex items-center justify-center text-muted hover:text-text hover:bg-hover/60 transition-colors shrink-0"
              title={t("common.close")}
            >
              <I.X size={11} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onToggle}
              className="flex-1 flex items-center gap-1 text-[10px] font-semibold tracking-[0.08em] uppercase text-muted/60 hover:text-muted transition-colors"
            >
              <I.ChevronRight
                size={9}
                className={cn("transition-transform shrink-0", open && "rotate-90")}
              />
              <span>{t("sidebar.pages")}</span>
            </button>
            <div className="flex items-center gap-0.5 opacity-0 group-hover/sec:opacity-100 transition-opacity">
              {open && navNodes.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => menuTreeRef.current?.expandAll()}
                    className="w-5 h-5 rounded-sm hover:bg-hover/60 flex items-center justify-center text-muted hover:text-text"
                    title="Mở rộng tất cả"
                  >
                    <I.ChevronDown size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => menuTreeRef.current?.collapseAll()}
                    className="w-5 h-5 rounded-sm hover:bg-hover/60 flex items-center justify-center text-muted hover:text-text"
                    title="Thu gọn tất cả"
                  >
                    <I.ChevronUp size={11} />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="w-5 h-5 rounded-sm hover:bg-hover/60 flex items-center justify-center text-muted hover:text-text"
                title={t("sidebar.search")}
              >
                <I.Search size={11} />
              </button>
              {onAiAdd && (
                <button
                  type="button"
                  onClick={onAiAdd}
                  className="w-5 h-5 rounded-sm hover:bg-accent/20 flex items-center justify-center text-accent"
                  title={t("sidebar.add_ai", { kind })}
                >
                  <I.Sparkles size={11} />
                </button>
              )}
              {onAdd && (
                <button
                  type="button"
                  onClick={onAdd}
                  className="w-5 h-5 rounded-sm hover:bg-hover/60 flex items-center justify-center text-muted hover:text-text"
                  title={t("sidebar.add_blank", { kind })}
                >
                  <I.Plus size={12} />
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {ql ? (
        <ul className="py-1">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted">Không tìm thấy trang</li>
          ) : (
            results.map((p) => {
              const active = pathname === p.to || activePageId === p.id;
              const IconC = I[p.icon] ?? I.Layout;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onOpen(p.to);
                      onNavigate?.();
                    }}
                    className={cn(
                      "w-full text-left pl-4 pr-3 py-1.5 text-sm flex items-center gap-2 transition-colors",
                      active
                        ? "bg-accent/10 text-accent font-medium"
                        : "text-text hover:bg-hover/40",
                    )}
                  >
                    <IconC size={13} className="shrink-0 text-muted" />
                    <span className="truncate">{p.name}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : (
        open && (
          <>
            {!orphanIsolated && (
              <MenuTree
                ref={menuTreeRef}
                nodes={navNodes}
                activePageId={activePageId}
                onSelect={(id) => {
                  onOpen(`/pages/${id}`);
                  onNavigate?.();
                }}
                storageKey="sidebar"
                compact
                isolatable
              />
            )}
            {orphanPages.length > 0 && (
              <div className="mt-1 pt-1 border-t border-border/30">
                <div className="group/orphsec flex items-center px-3 py-1">
                  {orphanSearchOpen ? (
                    <>
                      <I.Search size={10} className="shrink-0 text-muted/60" />
                      <input
                        ref={orphanSearchRef}
                        type="text"
                        value={orphanQ}
                        onChange={(e) => setOrphanQ(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setOrphanSearchOpen(false);
                            setOrphanQ("");
                          }
                        }}
                        placeholder="Tìm trang chưa gắn…"
                        className="flex-1 bg-transparent outline-none text-[11px] text-text placeholder:text-muted/40 min-w-0 ml-1.5"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setOrphanSearchOpen(false);
                          setOrphanQ("");
                        }}
                        title={t("common.close")}
                        className="w-4 h-4 rounded-sm flex items-center justify-center text-muted hover:text-text shrink-0"
                      >
                        <I.X size={10} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setOrphanCollapsed((c) => !c)}
                        className="flex-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted/50 font-semibold hover:text-muted transition-colors"
                        title={orphanCollapsed ? "Mở rộng" : "Thu gọn"}
                      >
                        <I.ChevronRight
                          size={9}
                          className={cn(
                            "transition-transform shrink-0",
                            !orphanCollapsed && "rotate-90",
                          )}
                        />
                        <span>Chưa gắn menu</span>
                        <span className="text-muted/30 normal-case tracking-normal">
                          {orphanPages.length}
                        </span>
                      </button>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setOrphanIsolated((v) => !v);
                            setOrphanCollapsed(false);
                          }}
                          title={
                            orphanIsolated
                              ? "Bỏ cô lập (hiện cả cây menu)"
                              : "Cô lập (chỉ hiện nhóm này)"
                          }
                          className={cn(
                            "w-4 h-4 rounded-sm flex items-center justify-center transition-opacity shrink-0",
                            orphanIsolated
                              ? "text-accent"
                              : "text-muted/40 hover:text-text opacity-0 group-hover/orphsec:opacity-100",
                          )}
                        >
                          <I.Maximize size={10} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setOrphanSearchOpen(true)}
                          title="Tìm trong nhóm này"
                          className="w-4 h-4 rounded-sm flex items-center justify-center text-muted/40 hover:text-text opacity-0 group-hover/orphsec:opacity-100 transition-opacity shrink-0"
                        >
                          <I.Search size={10} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
                {!orphanCollapsed && (
                  <>
                    {oql && orphanFiltered.length === 0 && (
                      <div className="px-4 py-1 text-[11px] text-muted/50">
                        Không có trang khớp.
                      </div>
                    )}
                    <ul>
                      {orphanFiltered.map((p) => {
                        const active = pathname === p.to || activePageId === p.id;
                        const IconC = I[p.icon] ?? I.Layout;
                        // Số nút hành động (gán + xoá) để chừa lề phải.
                        const actN = (onAssignPage ? 1 : 0) + (onDeletePage ? 1 : 0);
                        return (
                          <li key={p.id} className="relative group/orphan">
                            <button
                              type="button"
                              onClick={() => {
                                onOpen(p.to);
                                onNavigate?.();
                              }}
                              className={cn(
                                "w-full text-left pl-4 py-1.5 text-sm flex items-center gap-2 transition-colors",
                                actN >= 2 ? "pr-12" : "pr-7",
                                active
                                  ? "bg-accent/10 text-accent font-medium"
                                  : "text-text hover:bg-hover/40",
                              )}
                            >
                              <IconC size={13} className="shrink-0 text-muted" />
                              <span className="truncate">{p.name}</span>
                            </button>
                            <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover/orphan:opacity-100 transition-opacity">
                              {onAssignPage && (
                                <button
                                  type="button"
                                  onClick={() => onAssignPage({ id: p.id, name: p.name })}
                                  className="w-5 h-5 rounded-sm flex items-center justify-center text-muted/40 hover:bg-hover/80 hover:text-accent"
                                  title="Gán vào menu"
                                >
                                  <I.GitBranch size={11} />
                                </button>
                              )}
                              {onDeletePage && (
                                <button
                                  type="button"
                                  onClick={() => onDeletePage(p.id)}
                                  className="w-5 h-5 rounded-sm flex items-center justify-center text-muted/30 hover:text-danger"
                                  title={t("common.delete")}
                                >
                                  <I.Trash size={11} />
                                </button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}

/* Nhóm điều hướng GỌN LẠI — tiêu đề bấm để mở/đóng. Khi sidebar
   ở chế độ thu nhỏ (icon-only) thì bỏ tiêu đề, hiện thẳng item. */
function NavGroup({
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

export function Sidebar() {
  const t = useT();
  const isMobile = useIsMobile();
  const storeCollapsed = useUI((s) => s.sidebarCollapsed);
  // Mobile = off-canvas drawer luôn hiển thị bản đầy đủ (không icon-only).
  const collapsed = isMobile ? false : storeCollapsed;
  const mobileNavOpen = useUI((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUI((s) => s.setMobileNavOpen);
  const setAiCreateTarget = useUI((s) => s.setAiCreateTarget);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const favs = useFavs();

  // Trạng thái mở/đóng các section — NHỚ qua reload (localStorage). Merge với
  // defaults để key mới (thêm section sau này) vẫn có giá trị mặc định.
  const [sectionsOpen, setSectionsOpen] = useState(() => {
    const defaults = {
      entities: true,
      pages: true,
      workflows: true,
      agents: true,
      datasources: true,
      ops: true,
      settings: false,
    };
    try {
      const r = localStorage.getItem("sidebar-sections-open");
      return r ? { ...defaults, ...(JSON.parse(r) as Partial<typeof defaults>) } : defaults;
    } catch {
      return defaults;
    }
  });
  const allOpen = Object.values(sectionsOpen).some(Boolean);
  const toggleAll = () => {
    const next = !allOpen;
    setSectionsOpen({
      entities: next,
      pages: next,
      workflows: next,
      agents: next,
      datasources: next,
      ops: next,
      settings: next,
    });
  };
  const toggle = (key: keyof typeof sectionsOpen) => () =>
    setSectionsOpen((s) => ({ ...s, [key]: !s[key] }));

  /** Accordion cho Vận hành ↔ Cấu hình: mở nhóm này thì thu gọn nhóm kia. */
  const toggleExclusive = (key: "ops" | "settings") => () =>
    setSectionsOpen((s) => {
      const opening = !s[key];
      return { ...s, ops: opening && key === "ops", settings: opening && key === "settings" };
    });

  // Lưu trạng thái mở/đóng section mỗi khi đổi → reload khôi phục đúng như trước.
  useEffect(() => {
    try {
      localStorage.setItem("sidebar-sections-open", JSON.stringify(sectionsOpen));
    } catch {}
  }, [sectionsOpen]);

  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const closeSearch = () => {
    setSearchOpen(false);
    setSearch("");
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ phản ứng khi collapsed đổi; closeSearch là helper local ổn định, thêm vào deps sẽ chạy effect thừa
  useEffect(() => {
    if (collapsed) closeSearch();
  }, [collapsed]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  // Mobile off-canvas: Esc đóng drawer.
  useEffect(() => {
    if (!isMobile || !mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMobile, mobileNavOpen, setMobileNavOpen]);

  // Đổi route → tự đóng drawer mobile (mọi Link/navigate trong sidebar).
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ phản ứng khi pathname đổi; setMobileNavOpen ổn định
  useEffect(() => {
    if (isMobile) setMobileNavOpen(false);
  }, [pathname]);

  // Khớp cả nhãn hiển thị (name) lẫn tên kỹ thuật (techName — vd tr_sanpham):
  // sau re-migrate, entity mang tên bảng nguồn nên tìm theo tên kỹ thuật là
  // thao tác thường xuyên khi đối chiếu với DQHF/SQL.
  const filterBySearch = <T extends { name: string; techName?: string }>(arr: T[]): T[] => {
    const q = search.trim().toLowerCase();
    if (!q) return arr;
    return arr.filter(
      (i) => i.name.toLowerCase().includes(q) || (i.techName ?? "").toLowerCase().includes(q),
    );
  };
  const effectiveSectionsOpen = search.trim()
    ? {
        ...sectionsOpen,
        entities: true,
        pages: true,
        workflows: true,
        agents: true,
        datasources: true,
      }
    : sectionsOpen;

  // RBAC — chặn nút theo role. Lấy role+enforce để component re-render khi đổi.
  const role = useRbac((s) => s.role);
  const enforce = useRbac((s) => s.enforce);
  const isViewer = role === "viewer";
  const myGroupIds = useUserObjects((s) => s.myGroupIds);
  const can = (action: "create" | "edit" | "delete", obj: ObjectType) =>
    !enforce || roleCan(role, action, obj);

  // Đối tượng low-code — nguồn dữ liệu là backend (qua useUserObjects).
  const userEntities = useUserObjects((s) => s.entities);
  const userPages = useUserObjects((s) => s.pages);

  // Cây điều hướng TRANG theo MENU DQHF (legacy_menu_map.navTree). Admin/editor
  // thấy cả trang draft; rỗng (chưa link menu) → fallback danh sách phẳng.
  const [navNodes, setNavNodes] = useState<NavNode[]>([]);
  // Trang đang gán vào menu (mở modal) + key refetch cây sau khi gán xong.
  const [assignMenuPage, setAssignMenuPage] = useState<{ id: string; name: string } | null>(null);
  const [navReloadKey, setNavReloadKey] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: navReloadKey là trigger refetch chủ động (không đọc trong effect)
  useEffect(() => {
    let alive = true;
    createLegacyMenuClient("")
      .navTree()
      .then((rows) => {
        if (alive) setNavNodes(rows);
      })
      .catch(() => undefined); // fail-safe: thiếu menu → danh sách phẳng
    return () => {
      alive = false;
    };
  }, [navReloadKey]);
  const userWorkflows = useUserObjects((s) => s.workflows);
  const userAgents = useUserObjects((s) => s.agents);
  const userDataSources = useUserObjects((s) => s.dataSources);
  // Membership: primary agent + my agents — dùng để pin ★/★★ và sort lên đầu.
  const primaryAgentId = useAuth((s) => s.primaryAgentId);
  const myAgentRoles = useAuth((s) => s.myAgentRoles);
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  /** Trọng số sort: primary=0, my-agent=1, khác=2; cùng nhóm thì giữ thứ tự cũ. */
  const agentWeight = (id: string): number => {
    if (id === primaryAgentId) return 0;
    if (myAgentRoles[id]) return 1;
    return 2;
  };
  const sortedAgents = [...userAgents].sort((a, b) => agentWeight(a.id) - agentWeight(b.id));
  const {
    addEntity,
    deleteEntity,
    renameEntity,
    addPage,
    deletePage,
    renamePage,
    addWorkflow,
    deleteWorkflow,
    renameWorkflow,
    addAgent,
    deleteAgent,
    renameAgent,
    addDataSource,
    deleteDataSource,
    renameDataSource,
  } = useUserObjects.getState();

  /** Thu gọn 2 nhóm Vận hành + Cấu hình khi user điều hướng vào object/page/... */
  const collapseOpsSettings = () => setSectionsOpen((s) => ({ ...s, ops: false, settings: false }));

  /** Generic delete + navigate home nếu đang ở route đó */
  const onDeleteFn =
    (kind: string, fn: (id: string) => void, basePath: string) => async (id: string) => {
      const ok = await dialog.confirm(t("sidebar.confirm_delete", { kind, id }), {
        title: t("sidebar.confirm_delete_title", { kind }),
        confirmText: t("common.delete"),
        danger: true,
      });
      if (!ok) return;
      fn(id);
      if (pathname === `${basePath}/${id}`) navigate({ to: "/" });
    };
  const handleDeleteEntity = onDeleteFn("entity", deleteEntity, "/entities");
  const handleRenameEntity = (id: string, newName: string) => renameEntity(id, newName);
  const handleDeletePage = onDeleteFn("page", deletePage, "/pages");
  const handleRenamePage = (id: string, newName: string) => renamePage(id, newName);
  const handleDeleteWorkflow = onDeleteFn("workflow", deleteWorkflow, "/workflows");
  const handleRenameWorkflow = (id: string, newName: string) => renameWorkflow(id, newName);
  const handleDeleteAgent = onDeleteFn("agent", deleteAgent, "/agents");
  const handleRenameAgent = (id: string, newName: string) => renameAgent(id, newName);
  const handleDeleteDataSource = onDeleteFn("datasource", deleteDataSource, "/datasources");
  const handleRenameDataSource = (id: string, newName: string) => renameDataSource(id, newName);

  /** Prompt name + tạo + navigate. id là uuid client cấp (khớp backend). */
  const promptName = async (label: string): Promise<{ id: string; name: string } | null> => {
    const name = (
      await dialog.prompt(t("sidebar.new_prompt", { kind: label }), "", {
        title: t("sidebar.new_title", { kind: label }),
      })
    )?.trim();
    if (!name) return null;
    return { id: crypto.randomUUID(), name };
  };

  const handleAddEntity = async () => {
    const r = await promptName("entity");
    if (!r) return;
    addEntity({ id: r.id, name: r.name, icon: "Database", mcp: "", fields: [] });
    navigate({ to: "/entities/$id", params: { id: r.id } });
  };
  const handleAddPage = async () => {
    const r = await promptName("page");
    if (!r) return;
    addPage({ id: r.id, name: r.name, icon: "Layout", updated: "vừa xong", author: "bạn" });
    navigate({ to: "/pages/$id", params: { id: r.id } });
  };
  const handleAddWorkflow = async () => {
    const r = await promptName("workflow");
    if (!r) return;
    addWorkflow({ id: r.id, name: r.name, icon: "Workflow", status: "active", runs: 0 });
    navigate({ to: "/workflows/$id", params: { id: r.id } });
  };
  const handleAddAgent = async () => {
    const r = await promptName("agent");
    if (!r) return;
    addAgent({ id: r.id, name: r.name, model: "claude-sonnet-4-6", tools: 0 });
    navigate({ to: "/agents/$id", params: { id: r.id } });
  };
  const handleAddDataSource = async () => {
    const r = await promptName("datasource");
    if (!r) return;
    addDataSource({ id: r.id, name: r.name, icon: "Database" });
    navigate({ to: "/datasources/$id", params: { id: r.id } });
  };

  return (
    <>
      {/* Backdrop off-canvas trên mobile — click ngoài đóng drawer */}
      {isMobile && mobileNavOpen && (
        <button
          type="button"
          aria-label={t("topbar.toggle_sidebar")}
          className="fixed inset-0 z-[690] bg-black/40 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside
        className={cn(
          "border-r border-border bg-panel flex flex-col overflow-hidden",
          isMobile
            ? cn(
                "fixed inset-y-0 left-0 z-[695] w-[280px] max-w-[85vw] shadow-2xl transition-transform duration-200",
                mobileNavOpen ? "translate-x-0" : "-translate-x-full",
              )
            : "shrink-0",
        )}
        style={
          isMobile ? undefined : { width: collapsed ? 56 : 240, transition: "width 180ms ease" }
        }
      >
        {/* Home — shrink-0 nên luôn hiển thị, NavGroups dù cao đến đâu cũng không che được */}
        <div className="shrink-0 pt-1">
          <div className="relative group">
            {/* Search mode: thay thế link Home bằng ô nhập tìm kiếm inline */}
            {!collapsed && searchOpen ? (
              <div className={cn("sidebar-item cursor-default pr-[52px]")}>
                <span className="icon text-muted shrink-0">
                  <I.Search size={14} />
                </span>
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") closeSearch();
                  }}
                  placeholder={t("sidebar.search")}
                  className="flex-1 bg-transparent outline-none text-[12px] text-text placeholder:text-muted/50 min-w-0"
                />
              </div>
            ) : (
              <Link
                to="/"
                className={cn(
                  "sidebar-item",
                  pathname === "/" && "active",
                  !collapsed && "pr-[52px]",
                )}
                title={t("sidebar.workspace")}
                onClick={() => setSectionsOpen((s) => ({ ...s, ops: false, settings: false }))}
              >
                <span className="icon text-muted shrink-0">
                  <I.Home size={14} />
                </span>
                {!collapsed && <span className="truncate flex-1">{t("sidebar.workspace")}</span>}
              </Link>
            )}

            {!collapsed && (
              <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                {searchOpen ? (
                  <button
                    type="button"
                    onClick={closeSearch}
                    className="w-6 h-6 rounded-sm flex items-center justify-center text-muted hover:text-text hover:bg-hover/60 transition-colors"
                    title="Đóng tìm kiếm"
                  >
                    <I.X size={11} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSearchOpen(true)}
                    title={t("sidebar.search")}
                    className="w-6 h-6 rounded-sm flex items-center justify-center text-muted/40 hover:text-text hover:bg-hover/60 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <I.Search size={11} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={toggleAll}
                  title={allOpen ? t("sidebar.collapse_all") : t("sidebar.expand_all")}
                  className="w-6 h-6 rounded-sm flex items-center justify-center text-muted/50 hover:text-text hover:bg-hover/60 transition-colors"
                >
                  <I.ChevronsUpDown size={11} />
                </button>
              </div>
            )}
          </div>
          <FavoritesSection
            favs={favs.favs}
            onRemove={favs.remove}
            pathname={pathname}
            collapsed={collapsed}
          />
        </div>

        <div className="flex-1 overflow-y-auto pb-1">
          {!isViewer && (!search.trim() || filterBySearch(userEntities).length > 0) && (
            <SidebarSection
              title={t("sidebar.entities")}
              collapsed={collapsed}
              pathname={pathname}
              open={effectiveSectionsOpen.entities}
              onToggle={toggle("entities")}
              onAdd={can("create", "entity") ? handleAddEntity : undefined}
              onAiAdd={can("create", "entity") ? () => setAiCreateTarget("entity") : undefined}
              onDelete={can("delete", "entity") ? handleDeleteEntity : undefined}
              onRename={can("edit", "entity") ? handleRenameEntity : undefined}
              sectionKey="entities"
              onNavigate={collapseOpsSettings}
              extraButtons={
                <button
                  type="button"
                  onClick={() => navigate({ to: "/entities/erd" })}
                  className="w-5 h-5 rounded-sm hover:bg-hover/60 flex items-center justify-center text-muted hover:text-text"
                  title="ERD Diagram"
                >
                  <I.Layers size={11} />
                </button>
              }
              items={filterBySearch(userEntities).map((e) => ({
                id: e.id,
                name: e.name,
                iconName: e.icon,
                to: `/entities/${e.id}`,
                userOwned: true,
                isFav: favs.isFav(e.id),
                onFavorite: () =>
                  favs.toggle({
                    id: e.id,
                    to: `/entities/${e.id}`,
                    label: e.name,
                    iconName: e.icon,
                  }),
              }))}
            />
          )}
          {!isViewer && (!search.trim() || filterBySearch(userDataSources).length > 0) && (
            <SidebarSection
              title="Nguồn dữ liệu"
              collapsed={collapsed}
              pathname={pathname}
              open={effectiveSectionsOpen.datasources}
              onToggle={toggle("datasources")}
              onAdd={can("create", "datasource") ? handleAddDataSource : undefined}
              onDelete={can("delete", "datasource") ? handleDeleteDataSource : undefined}
              onRename={can("edit", "datasource") ? handleRenameDataSource : undefined}
              sectionKey="datasources"
              onNavigate={collapseOpsSettings}
              extraButtons={
                <button
                  type="button"
                  onClick={() => navigate({ to: "/datasources/$id", params: { id: "__sql__" } })}
                  className="w-5 h-5 rounded-sm hover:bg-accent/20 flex items-center justify-center text-muted hover:text-accent"
                  title="Mở màn hình SQL (soạn → lưu thành / áp dụng vào nguồn dữ liệu)"
                >
                  <I.Terminal size={11} />
                </button>
              }
              items={filterBySearch(userDataSources).map((d) => ({
                id: d.id,
                name: d.name,
                iconName: d.icon,
                to: `/datasources/${d.id}`,
                userOwned: true,
                isFav: favs.isFav(d.id),
                onFavorite: () =>
                  favs.toggle({
                    id: d.id,
                    to: `/datasources/${d.id}`,
                    label: d.name,
                    iconName: d.icon,
                  }),
              }))}
            />
          )}
          {(() => {
            const pagesBase = isViewer
              ? userPages.filter(
                  (p) =>
                    p.isPublished &&
                    (!p.viewerGroupIds?.length ||
                      p.viewerGroupIds.some((gid) => myGroupIds.includes(gid))),
                )
              : userPages;
            // Trang tĩnh: route hardcode không nằm trong userPages (vd MES Mục
            // tiêu sản xuất). Không userOwned → không xóa/rename/kéo-thả.
            const staticPages: SectionItem[] = [
              {
                id: "/mes/muctieu-sanxuat",
                name: "Mục tiêu sản xuất",
                iconName: "Calculator",
                to: "/mes/muctieu-sanxuat",
                isFav: favs.isFav("/mes/muctieu-sanxuat"),
                onFavorite: () =>
                  favs.toggle({
                    id: "/mes/muctieu-sanxuat",
                    to: "/mes/muctieu-sanxuat",
                    label: "Mục tiêu sản xuất",
                    iconName: "Calculator",
                  }),
              },
            ];
            const pageItems: SectionItem[] = [
              ...filterBySearch(staticPages),
              ...filterBySearch(pagesBase).map((p) => ({
                id: p.id,
                name: p.name,
                iconName: p.icon,
                to: `/pages/${p.id}`,
                userOwned: true,
                isFav: favs.isFav(p.id),
                onFavorite: () =>
                  favs.toggle({ id: p.id, to: `/pages/${p.id}`, label: p.name, iconName: p.icon }),
              })),
            ];
            if (search.trim() && pageItems.length === 0) return null;
            // CÂY MENU DQHF: khi có node link trang + không thu nhỏ + không tìm
            // kiếm → điều hướng theo cây (giống Portal). Trang chưa gắn menu →
            // nhóm "Chưa gắn menu" cuối cây (vẫn xóa được). Ngược lại: danh
            // sách phẳng (fallback chưa link menu, hoặc đang search/thu nhỏ).
            const linkedPageIds = new Set(
              navNodes.filter((n) => n.pageId).map((n) => n.pageId as string),
            );
            const useTree = navNodes.some((n) => n.pageId) && !collapsed && !search.trim();
            if (useTree) {
              const orphanPages = [
                ...staticPages.map((s) => ({
                  id: s.id,
                  name: s.name,
                  icon: s.iconName,
                  to: s.to,
                })),
                ...pagesBase
                  .filter((p) => !linkedPageIds.has(p.id))
                  .map((p) => ({ id: p.id, name: p.name, icon: p.icon, to: `/pages/${p.id}` })),
              ];
              // Toàn bộ trang (gắn + chưa gắn) để ô tìm kiếm lọc.
              const allPages = [
                ...staticPages.map((s) => ({
                  id: s.id,
                  name: s.name,
                  icon: s.iconName,
                  to: s.to,
                })),
                ...pagesBase.map((p) => ({
                  id: p.id,
                  name: p.name,
                  icon: p.icon,
                  to: `/pages/${p.id}`,
                })),
              ];
              return (
                <PagesTreeSection
                  collapsed={collapsed}
                  pathname={pathname}
                  open={effectiveSectionsOpen.pages}
                  onToggle={toggle("pages")}
                  onAdd={can("create", "page") ? handleAddPage : undefined}
                  onAiAdd={can("create", "page") ? () => setAiCreateTarget("page") : undefined}
                  onNavigate={collapseOpsSettings}
                  navNodes={navNodes}
                  orphanPages={orphanPages}
                  allPages={allPages}
                  onOpen={(to) => navigate({ to })}
                  onDeletePage={can("delete", "page") ? handleDeletePage : undefined}
                  onAssignPage={can("edit", "settings") ? setAssignMenuPage : undefined}
                />
              );
            }
            return (
              <SidebarSection
                title={t("sidebar.pages")}
                collapsed={collapsed}
                pathname={pathname}
                open={effectiveSectionsOpen.pages}
                onToggle={toggle("pages")}
                onAdd={can("create", "page") ? handleAddPage : undefined}
                onAiAdd={can("create", "page") ? () => setAiCreateTarget("page") : undefined}
                onDelete={can("delete", "page") ? handleDeletePage : undefined}
                onRename={can("edit", "page") ? handleRenamePage : undefined}
                sectionKey="pages"
                onNavigate={collapseOpsSettings}
                items={pageItems}
              />
            );
          })()}
          {!isViewer && (!search.trim() || filterBySearch(userWorkflows).length > 0) && (
            <SidebarSection
              title={t("sidebar.workflows")}
              collapsed={collapsed}
              pathname={pathname}
              open={effectiveSectionsOpen.workflows}
              onToggle={toggle("workflows")}
              onAdd={can("create", "workflow") ? handleAddWorkflow : undefined}
              onAiAdd={can("create", "workflow") ? () => setAiCreateTarget("workflow") : undefined}
              onDelete={can("delete", "workflow") ? handleDeleteWorkflow : undefined}
              onRename={can("edit", "workflow") ? handleRenameWorkflow : undefined}
              onNavigate={collapseOpsSettings}
              extraButtons={
                can("create", "workflow") && !collapsed ? (
                  <button
                    type="button"
                    title="Thư viện workflow mẫu"
                    onClick={() => navigate({ to: "/workflows/gallery" })}
                    className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-foreground hover:bg-hover transition-colors"
                  >
                    <I.Library size={13} />
                  </button>
                ) : undefined
              }
              items={filterBySearch(userWorkflows).map((w) => ({
                id: w.id,
                name: w.name,
                iconName: w.icon,
                to: `/workflows/${w.id}`,
                badge: w.status === "paused" ? "⏸" : undefined,
                userOwned: true,
                isFav: favs.isFav(w.id),
                onFavorite: () =>
                  favs.toggle({
                    id: w.id,
                    to: `/workflows/${w.id}`,
                    label: w.name,
                    iconName: w.icon,
                  }),
              }))}
            />
          )}
          {!isViewer && (!search.trim() || filterBySearch(sortedAgents).length > 0) && (
            <SidebarSection
              title={t("sidebar.agents")}
              collapsed={collapsed}
              pathname={pathname}
              open={effectiveSectionsOpen.agents}
              onToggle={toggle("agents")}
              onAdd={can("create", "agent") ? handleAddAgent : undefined}
              onAiAdd={can("create", "agent") ? () => setAiCreateTarget("agent") : undefined}
              onDelete={can("delete", "agent") ? handleDeleteAgent : undefined}
              onRename={can("edit", "agent") ? handleRenameAgent : undefined}
              onNavigate={collapseOpsSettings}
              extraButtons={
                can("create", "agent") && !collapsed ? (
                  <button
                    type="button"
                    title={t("sidebar.agent_library")}
                    onClick={() => navigate({ to: "/agents/library" })}
                    className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-foreground hover:bg-hover transition-colors"
                  >
                    <I.Library size={13} />
                  </button>
                ) : undefined
              }
              items={filterBySearch(sortedAgents).map((a) => ({
                id: a.id,
                name: a.name,
                iconName: "Bot" as const,
                to: `/agents/${a.id}`,
                badge: a.id === primaryAgentId ? "★★" : myAgentRoles[a.id] ? "★" : undefined,
                userOwned: true,
                isFav: favs.isFav(a.id),
                onFavorite: () =>
                  favs.toggle({ id: a.id, to: `/agents/${a.id}`, label: a.name, iconName: "Bot" }),
              }))}
            />
          )}
        </div>

        <div className="border-t border-border py-1 overflow-y-auto shrink min-h-0">
          <NavGroup
            title={t("sidebar.group_ops")}
            collapsed={collapsed}
            open={sectionsOpen.ops}
            onToggle={toggleExclusive("ops")}
            scrollCap
          >
            {/* /server-data ẩn khỏi Sidebar — truy cập trực tiếp qua URL khi cần */}
            <SidebarItem
              to="/activity"
              active={pathname === "/activity"}
              icon={<I.Activity size={14} />}
              collapsed={collapsed}
              label={t("sidebar.activity")}
              isFavorited={favs.isFav("/activity")}
              onToggleFavorite={() =>
                favs.toggle({
                  id: "/activity",
                  to: "/activity",
                  label: t("sidebar.activity"),
                  iconName: "Activity",
                })
              }
            />
            <SidebarItem
              to="/approvals"
              active={pathname === "/approvals"}
              icon={<I.CheckSq size={14} />}
              collapsed={collapsed}
              label={t("sidebar.approvals")}
              isFavorited={favs.isFav("/approvals")}
              onToggleFavorite={() =>
                favs.toggle({
                  id: "/approvals",
                  to: "/approvals",
                  label: t("sidebar.approvals"),
                  iconName: "CheckSq",
                })
              }
            />
            <SidebarItem
              to="/org-chart"
              active={pathname === "/org-chart"}
              icon={<I.GitBranch size={14} />}
              collapsed={collapsed}
              label={t("sidebar.org_chart")}
              isFavorited={favs.isFav("/org-chart")}
              onToggleFavorite={() =>
                favs.toggle({
                  id: "/org-chart",
                  to: "/org-chart",
                  label: t("sidebar.org_chart"),
                  iconName: "GitBranch",
                })
              }
            />
            <SidebarItem
              to="/knowledge"
              active={pathname === "/knowledge"}
              icon={<I.File size={14} />}
              collapsed={collapsed}
              label={t("sidebar.knowledge")}
              isFavorited={favs.isFav("/knowledge")}
              onToggleFavorite={() =>
                favs.toggle({
                  id: "/knowledge",
                  to: "/knowledge",
                  label: t("sidebar.knowledge"),
                  iconName: "File",
                })
              }
            />
            {/* MES / Sản xuất — port DQHF */}
            <SidebarItem
              to="/banve"
              active={pathname === "/banve"}
              icon={<I.FileText size={14} />}
              collapsed={collapsed}
              label="Xem bản vẽ"
              isFavorited={favs.isFav("/banve")}
              onToggleFavorite={() =>
                favs.toggle({
                  id: "/banve",
                  to: "/banve",
                  label: "Xem bản vẽ",
                  iconName: "FileText",
                })
              }
            />
            {!isViewer && (
              <SidebarItem
                to="/sanluong"
                active={pathname === "/sanluong"}
                icon={<I.Box size={14} />}
                collapsed={collapsed}
                label="Nhập sản lượng"
                isFavorited={favs.isFav("/sanluong")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/sanluong",
                    to: "/sanluong",
                    label: "Nhập sản lượng",
                    iconName: "Box",
                  })
                }
              />
            )}
            {!isViewer && (
              <SidebarItem
                to="/ketoan/cong-no"
                active={pathname === "/ketoan/cong-no"}
                icon={<I.Receipt size={14} />}
                collapsed={collapsed}
                label="Công nợ NCC"
                isFavorited={favs.isFav("/ketoan/cong-no")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/ketoan/cong-no",
                    to: "/ketoan/cong-no",
                    label: "Công nợ NCC",
                    iconName: "Receipt",
                  })
                }
              />
            )}
            {!isViewer && (
              <SidebarItem
                to="/ketoan/chi-phi"
                active={pathname === "/ketoan/chi-phi"}
                icon={<I.DollarSign size={14} />}
                collapsed={collapsed}
                label="Chi phí kinh doanh"
                isFavorited={favs.isFav("/ketoan/chi-phi")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/ketoan/chi-phi",
                    to: "/ketoan/chi-phi",
                    label: "Chi phí kinh doanh",
                    iconName: "DollarSign",
                  })
                }
              />
            )}
            {!isViewer && (
              <SidebarItem
                to="/ketoan/ket-qua"
                active={pathname === "/ketoan/ket-qua"}
                icon={<I.BarChart size={14} />}
                collapsed={collapsed}
                label="Kết quả kinh doanh"
                isFavorited={favs.isFav("/ketoan/ket-qua")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/ketoan/ket-qua",
                    to: "/ketoan/ket-qua",
                    label: "Kết quả kinh doanh",
                    iconName: "BarChart",
                  })
                }
              />
            )}
            {!isViewer && (
              <SidebarItem
                to="/ketoan/de-nghi-thanh-toan"
                active={pathname === "/ketoan/de-nghi-thanh-toan"}
                icon={<I.FileCheck size={14} />}
                collapsed={collapsed}
                label="Đề nghị thanh toán"
                isFavorited={favs.isFav("/ketoan/de-nghi-thanh-toan")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/ketoan/de-nghi-thanh-toan",
                    to: "/ketoan/de-nghi-thanh-toan",
                    label: "Đề nghị thanh toán",
                    iconName: "FileCheck",
                  })
                }
              />
            )}
            {!isViewer && (
              <SidebarItem
                to="/iot"
                active={pathname.startsWith("/iot")}
                icon={<I.Server size={14} />}
                collapsed={collapsed}
                label={t("sidebar.iot")}
                isFavorited={favs.isFav("/iot")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/iot",
                    to: "/iot",
                    label: t("sidebar.iot"),
                    iconName: "Server",
                  })
                }
              />
            )}
            {!isViewer && (
              <SidebarItem
                to="/procedures"
                active={pathname.startsWith("/procedures")}
                icon={<I.Terminal size={14} />}
                collapsed={collapsed}
                label={t("sidebar.procedures")}
                isFavorited={favs.isFav("/procedures")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/procedures",
                    to: "/procedures",
                    label: t("sidebar.procedures"),
                    iconName: "Terminal",
                  })
                }
              />
            )}
            {!isViewer && (
              <SidebarItem
                to="/enums"
                active={pathname.startsWith("/enums")}
                icon={<I.Tag size={14} />}
                collapsed={collapsed}
                label={t("sidebar.enums")}
                isFavorited={favs.isFav("/enums")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/enums",
                    to: "/enums",
                    label: t("sidebar.enums"),
                    iconName: "Tag",
                  })
                }
              />
            )}
            {!isViewer && (
              <SidebarItem
                to="/tools"
                active={pathname.startsWith("/tools")}
                icon={<I.Wand size={14} />}
                collapsed={collapsed}
                label={t("sidebar.tools")}
                isFavorited={favs.isFav("/tools")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/tools",
                    to: "/tools",
                    label: t("sidebar.tools"),
                    iconName: "Wand",
                  })
                }
              />
            )}
            <SidebarItem
              to="/feedback"
              active={pathname.startsWith("/feedback")}
              icon={<I.HelpCircle size={14} />}
              collapsed={collapsed}
              label={t("sidebar.feedback")}
              isFavorited={favs.isFav("/feedback")}
              onToggleFavorite={() =>
                favs.toggle({
                  id: "/feedback",
                  to: "/feedback",
                  label: t("sidebar.feedback"),
                  iconName: "HelpCircle",
                })
              }
            />
          </NavGroup>
          {!isViewer && (
            <NavGroup
              title={t("sidebar.group_settings")}
              collapsed={collapsed}
              open={sectionsOpen.settings}
              onToggle={toggleExclusive("settings")}
              scrollCap
            >
              <SidebarItem
                to="/settings/agents"
                active={pathname === "/settings/agents"}
                icon={<I.Bot size={14} />}
                collapsed={collapsed}
                label={t("sidebar.my_agents")}
                isFavorited={favs.isFav("/settings/agents")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/agents",
                    to: "/settings/agents",
                    label: t("sidebar.my_agents"),
                    iconName: "Bot",
                  })
                }
              />
              <SidebarItem
                to="/settings/rbac"
                active={pathname === "/settings/rbac"}
                icon={<I.Users size={14} />}
                collapsed={collapsed}
                label={t("sidebar.rbac")}
                isFavorited={favs.isFav("/settings/rbac")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/rbac",
                    to: "/settings/rbac",
                    label: t("sidebar.rbac"),
                    iconName: "Users",
                  })
                }
              />
              <SidebarItem
                to="/settings/companies"
                active={pathname === "/settings/companies"}
                icon={<I.Briefcase size={14} />}
                collapsed={collapsed}
                label={t("sidebar.companies")}
                isFavorited={favs.isFav("/settings/companies")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/companies",
                    to: "/settings/companies",
                    label: t("sidebar.companies"),
                    iconName: "Briefcase",
                  })
                }
              />
              {role === "admin" && (
                <SidebarItem
                  to="/settings/errors"
                  active={pathname === "/settings/errors"}
                  icon={<I.AlertOctagon size={14} />}
                  collapsed={collapsed}
                  label="Giám sát lỗi"
                  isFavorited={favs.isFav("/settings/errors")}
                  onToggleFavorite={() =>
                    favs.toggle({
                      id: "/settings/errors",
                      to: "/settings/errors",
                      label: "Giám sát lỗi",
                      iconName: "AlertOctagon",
                    })
                  }
                />
              )}
              <SidebarItem
                to="/settings/llm"
                active={pathname === "/settings/llm"}
                icon={<I.Sparkles size={14} />}
                collapsed={collapsed}
                label={t("sidebar.llm_profiles")}
                isFavorited={favs.isFav("/settings/llm")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/llm",
                    to: "/settings/llm",
                    label: t("sidebar.llm_profiles"),
                    iconName: "Sparkles",
                  })
                }
              />
              <SidebarItem
                to="/settings/embedding"
                active={pathname === "/settings/embedding"}
                icon={<I.Hash size={14} />}
                collapsed={collapsed}
                label={t("sidebar.embedding")}
                isFavorited={favs.isFav("/settings/embedding")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/embedding",
                    to: "/settings/embedding",
                    label: t("sidebar.embedding"),
                    iconName: "Hash",
                  })
                }
              />
              <SidebarItem
                to="/settings/mcp"
                active={pathname === "/settings/mcp"}
                icon={<I.Server size={14} />}
                collapsed={collapsed}
                label={t("sidebar.mcp_server")}
                isFavorited={favs.isFav("/settings/mcp")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/mcp",
                    to: "/settings/mcp",
                    label: t("sidebar.mcp_server"),
                    iconName: "Server",
                  })
                }
              />
              <SidebarItem
                to="/settings/transfer"
                active={pathname === "/settings/transfer"}
                icon={<I.Save size={14} />}
                collapsed={collapsed}
                label={t("sidebar.transfer")}
                isFavorited={favs.isFav("/settings/transfer")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/transfer",
                    to: "/settings/transfer",
                    label: t("sidebar.transfer"),
                    iconName: "Save",
                  })
                }
              />
              <SidebarItem
                to="/settings/backup"
                active={pathname === "/settings/backup"}
                icon={<I.Save size={14} />}
                collapsed={collapsed}
                label={t("sidebar.backup")}
                isFavorited={favs.isFav("/settings/backup")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/backup",
                    to: "/settings/backup",
                    label: t("sidebar.backup"),
                    iconName: "Save",
                  })
                }
              />
              <SidebarItem
                to="/settings/migration"
                active={pathname === "/settings/migration" || pathname === "/settings/cockpit"}
                icon={<I.Database size={14} />}
                collapsed={collapsed}
                label="Migrate DQHF"
                isFavorited={favs.isFav("/settings/migration")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/migration",
                    to: "/settings/migration",
                    label: "Migrate DQHF",
                    iconName: "Database",
                  })
                }
              />
              <SidebarItem
                to="/settings/menu-pages"
                active={pathname === "/settings/menu-pages"}
                icon={<I.GitBranch size={14} />}
                collapsed={collapsed}
                label="Gán trang cho menu"
                isFavorited={favs.isFav("/settings/menu-pages")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/menu-pages",
                    to: "/settings/menu-pages",
                    label: "Gán trang cho menu",
                    iconName: "GitBranch",
                  })
                }
              />
              <SidebarItem
                to="/settings/plugins"
                active={pathname === "/settings/plugins"}
                icon={<I.Package size={14} />}
                collapsed={collapsed}
                label={t("sidebar.plugins")}
                isFavorited={favs.isFav("/settings/plugins")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/plugins",
                    to: "/settings/plugins",
                    label: t("sidebar.plugins"),
                    iconName: "Package",
                  })
                }
              />
              <SidebarItem
                to="/settings/tools"
                active={pathname === "/settings/tools"}
                icon={<I.Wand size={14} />}
                collapsed={collapsed}
                label={t("sidebar.tools_mgmt")}
                isFavorited={favs.isFav("/settings/tools")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/tools",
                    to: "/settings/tools",
                    label: t("sidebar.tools_mgmt"),
                    iconName: "Wand",
                  })
                }
              />
              <SidebarItem
                to="/settings/embed"
                active={pathname === "/settings/embed"}
                icon={<I.Link size={14} />}
                collapsed={collapsed}
                label={t("sidebar.embed")}
                isFavorited={favs.isFav("/settings/embed")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/embed",
                    to: "/settings/embed",
                    label: t("sidebar.embed"),
                    iconName: "Link",
                  })
                }
              />
              <SidebarItem
                to="/settings/api-keys"
                active={pathname === "/settings/api-keys"}
                icon={<I.Key size={14} />}
                collapsed={collapsed}
                label={t("sidebar.api_keys")}
                isFavorited={favs.isFav("/settings/api-keys")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/api-keys",
                    to: "/settings/api-keys",
                    label: t("sidebar.api_keys"),
                    iconName: "Key",
                  })
                }
              />
              <SidebarItem
                to="/settings/viewer-groups"
                active={pathname === "/settings/viewer-groups"}
                icon={<I.Users size={14} />}
                collapsed={collapsed}
                label={t("sidebar.viewer_groups")}
                isFavorited={favs.isFav("/settings/viewer-groups")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/viewer-groups",
                    to: "/settings/viewer-groups",
                    label: t("sidebar.viewer_groups"),
                    iconName: "Users",
                  })
                }
              />
            </NavGroup>
          )}
        </div>

        {/* === User info + Đăng xuất === */}
        <div className="shrink-0 border-t border-border px-2 py-2 space-y-1.5">
          {/* Xem Portal (admin) — mở giao diện người dùng cuối ở TAB MỚI.
             Dùng <a target="_blank"> để mở cửa sổ/tab mới, không rời SPA hiện tại. */}
          {role === "admin" && (
            <a
              href="/portal"
              target="_blank"
              rel="noopener noreferrer"
              title="Xem Portal (mở tab mới)"
              className={cn(
                "flex items-center rounded-md text-muted hover:bg-hover/60 hover:text-text transition-colors",
                collapsed ? "w-full h-9 justify-center" : "gap-2 px-2 py-1.5 text-[13px]",
              )}
            >
              <I.ExternalLink size={collapsed ? 15 : 14} className="shrink-0" />
              {!collapsed && <span className="truncate flex-1">Xem Portal</span>}
            </a>
          )}
          {collapsed ? (
            <button
              type="button"
              title={t("sidebar.logout")}
              onClick={() => void logout()}
              className="w-full h-9 flex items-center justify-center rounded-md hover:bg-danger/10 text-muted hover:text-danger transition-colors"
            >
              <I.LogOut size={15} />
            </button>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-semibold shrink-0 select-none">
                {user?.name?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{user?.name ?? ""}</div>
                <div className="text-[10px] text-muted truncate">{user?.email ?? ""}</div>
              </div>
              <button
                type="button"
                title={t("sidebar.logout")}
                onClick={() => void logout()}
                className="w-7 h-7 rounded-md hover:bg-danger/10 text-muted hover:text-danger flex items-center justify-center transition-colors shrink-0"
              >
                <I.LogOut size={14} />
              </button>
            </div>
          )}
        </div>
      </aside>
      <AssignPageToMenuModal
        page={assignMenuPage}
        onClose={() => setAssignMenuPage(null)}
        onDone={() => setNavReloadKey((k) => k + 1)}
      />
    </>
  );
}
