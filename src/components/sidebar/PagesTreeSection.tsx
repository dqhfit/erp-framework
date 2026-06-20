/* PagesTreeSection — 2 nhóm "Menu" (cây legacy_menu_map) + "Trang".
   Tách từ Sidebar.tsx. */
import { useEffect, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { MenuTree, type MenuTreeHandle, type NavNode } from "@/components/MenuTree";
import { useT } from "@/hooks/useT";
import type { IconName } from "@/lib/object-types";
import { cn } from "@/lib/utils";

/* ─── PagesTreeSection — 2 nhóm: "Menu" + "Trang" ─────────────────
   Admin/editor: nhóm "Menu" = cây điều hướng DQHF (legacy_menu_map.navTree,
   trang ĐÃ gắn). Nhóm "Trang" = MỌI trang (đã/chưa gắn), mỗi trang có badge
   "có menu" nếu đang nằm trong menu. Lá/trang click → mở /pages/<id>. Khi
   sidebar thu nhỏ thì ẩn (cây cần bề ngang). */
export function PagesTreeSection({
  collapsed,
  pathname,
  open,
  onToggle,
  onAdd,
  onAiAdd,
  onNavigate,
  navNodes,
  allPages,
  onOpen,
  onUnassignPage,
  onChangeNodePage,
  onManageMenu,
  loading,
}: {
  collapsed: boolean;
  pathname: string;
  open: boolean;
  onToggle: () => void;
  onAdd?: () => void;
  onAiAdd?: () => void;
  onNavigate?: () => void;
  navNodes: NavNode[];
  /** Toàn bộ trang — dùng cho ô tìm kiếm nhanh (kết quả phẳng). */
  allPages: Array<{ id: string; name: string; icon: IconName; to: string }>;
  onOpen: (to: string) => void;
  /** Gỡ 1 trang ĐÃ gắn khỏi mục menu của nó. */
  onUnassignPage?: (node: NavNode) => void;
  /** Đổi TRANG liên kết của 1 mục menu (mở picker chọn trang khác). */
  onChangeNodePage?: (node: NavNode) => void;
  /** Mở trang Quản lý menu (icon trên header). */
  onManageMenu?: () => void;
  loading?: boolean;
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
  // Ref điều khiển mở rộng / thu gọn tất cả nhánh cây menu trang (admin/editor).
  const menuTreeRef = useRef<MenuTreeHandle>(null);
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);
  const closeSearch = () => {
    setSearchOpen(false);
    setQ("");
  };
  if (collapsed) return null;
  const kind = t("sidebar.pages").toLowerCase();
  const ql = q.trim().toLowerCase();
  const results = ql ? allPages.filter((p) => p.name.toLowerCase().includes(ql)) : [];
  return (
    <div>
      <div className="group/sec flex items-center px-3 py-0.5">
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
              <span>Menu</span>
            </button>
            {open && (
              <div className="flex items-center gap-0.5 opacity-0 group-hover/sec:opacity-100 transition-opacity">
                {navNodes.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => menuTreeRef.current?.expandAll()}
                      className="w-5 h-5 rounded-sm hover:bg-hover/60 flex items-center justify-center text-muted hover:text-text"
                      title="Mở rộng các nhánh"
                    >
                      <I.ChevronDown size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => menuTreeRef.current?.collapseAll()}
                      className="w-5 h-5 rounded-sm hover:bg-hover/60 flex items-center justify-center text-muted hover:text-text"
                      title="Thu gọn các nhánh"
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
                {onManageMenu && (
                  <button
                    type="button"
                    onClick={onManageMenu}
                    className="w-5 h-5 rounded-sm hover:bg-hover/60 flex items-center justify-center text-muted hover:text-text"
                    title="Quản lý menu"
                  >
                    <I.Settings size={11} />
                  </button>
                )}
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
            )}
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
          <MenuTree
            ref={menuTreeRef}
            nodes={navNodes}
            activePageId={activePageId}
            onSelect={(id) => {
              // id = route built-in ("/...") → mở thẳng; ngược lại là uuid trang DB.
              onOpen(id.startsWith("/") ? id : `/pages/${id}`);
              onNavigate?.();
            }}
            storageKey="sidebar"
            compact
            loading={loading}
            onUnassign={onUnassignPage}
            onChangePage={onChangeNodePage}
          />
        )
      )}
    </div>
  );
}
