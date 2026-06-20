import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { I } from "@/components/Icons";
import type { NavNode } from "@/components/MenuTree";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/stores/preferences";

interface PageInfo {
  id: string;
  name: string;
  icon: string;
}

interface PortalDashboardProps {
  userName: string;
  pages: PageInfo[];
  favs: { ids: Set<string>; isFav: (id: string) => boolean };
  onSelectPage: (id: string) => void;
  navRoots: NavNode[];
  navChildrenOf: Map<string, NavNode[]>;
  focusCategory?: string | null;
  onFocusCategoryUsed?: () => void;
  onOpenAllPages?: () => void;
}

function labelOf(n: NavNode): string {
  const nm = n.name ?? "";
  const suffix = ` - ${n.code}`;
  return nm.endsWith(suffix) ? nm.slice(0, -suffix.length) : nm;
}

export function PortalDashboard({
  userName,
  pages,
  favs,
  onSelectPage,
  navRoots,
  navChildrenOf,
  focusCategory,
  onFocusCategoryUsed,
  onOpenAllPages,
}: PortalDashboardProps) {
  const { prefs } = usePreferences();
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");

  const favPages = useMemo(() => pages.filter((p) => favs.isFav(p.id)), [pages, favs]);

  const recentPageIds = useMemo(() => {
    const ids = prefs.portal?.recentPages;
    if (!ids?.length) {
      // fallback: lastPageId + first 5 pages
      const last = prefs.portal?.lastPageId;
      if (!last) return [];
      const arr = [last];
      for (const p of pages) {
        if (p.id !== last) {
          arr.push(p.id);
          if (arr.length >= 12) break;
        }
      }
      return arr;
    }
    return ids.slice(0, 12);
  }, [prefs.portal?.recentPages, prefs.portal?.lastPageId, pages]);

  const recentPages = useMemo(
    () => recentPageIds.map((id) => pages.find((p) => p.id === id)).filter(Boolean) as PageInfo[],
    [recentPageIds, pages],
  );

  const ql = q.trim().toLowerCase();
  const filteredPages = ql ? pages.filter((p) => p.name.toLowerCase().includes(ql)) : null;

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!ql) return;
      // Điều hướng tới kết quả đầu tiên
      const found = pages.find((p) => p.name.toLowerCase().includes(ql));
      if (found) onSelectPage(found.id);
    },
    [ql, pages, onSelectPage],
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-12 sm:py-16">
        {/* Greeting + date */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-text tracking-tight">
            Xin chào, <span className="text-accent">{userName}</span>
          </h1>
          <p className="text-sm text-muted mt-1">
            Hôm nay là{" "}
            {new Date().toLocaleDateString("vi-VN", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>

        {/* Search */}
        <form onSubmit={onSubmit} className="relative mb-10">
          <I.Search
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted/40 pointer-events-none"
          />
          <input
            ref={searchRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm kiếm trang, báo cáo, chức năng..."
            className="w-full h-11 pl-10 pr-4 bg-panel-2 border border-border rounded-lg text-sm text-text placeholder:text-muted/40 outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-colors"
          />
          <kbd className="absolute right-3.5 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-muted/40 bg-bg rounded border border-border/40">
            ⌘K
          </kbd>
        </form>

        {/* Kết quả tìm kiếm */}
        {filteredPages && (
          <section className="mb-8">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted/60 mb-3">
              Tất cả ({filteredPages.length})
            </h2>
            {filteredPages.length === 0 ? (
              <p className="text-sm text-muted">Không tìm thấy trang</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {filteredPages.map((p) => {
                  const IconC =
                    (
                      I as Record<
                        string,
                        React.ComponentType<{ size?: number; className?: string }>
                      >
                    )[p.icon] ?? I.Layout;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onSelectPage(p.id)}
                      className="group flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-accent/5 transition-colors text-left"
                    >
                      <IconC
                        size={12}
                        className="shrink-0 text-muted/60 group-hover:text-accent transition-colors"
                      />
                      <span className="text-sm text-text truncate group-hover:text-accent transition-colors">
                        {p.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {!filteredPages && (
          <>
            {/* Favorites grid */}
            {favPages.length > 0 && (
              <section className="mb-8">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted/60 mb-3 flex items-center gap-1.5">
                  <I.Star size={12} className="text-warning" />
                  Yêu thích
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {favPages.map((p) => {
                    const IconC =
                      (
                        I as Record<
                          string,
                          React.ComponentType<{ size?: number; className?: string }>
                        >
                      )[p.icon] ?? I.Layout;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onSelectPage(p.id)}
                        className="group flex items-center gap-3 p-3.5 rounded-lg border border-border/60 bg-panel hover:bg-accent/5 hover:border-accent/20 transition-all text-left"
                      >
                        <span className="w-9 h-9 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0 group-hover:bg-accent/15 transition-colors">
                          <IconC size={16} />
                        </span>
                        <span className="text-sm text-text font-medium truncate group-hover:text-accent transition-colors">
                          {p.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
            {/* Recent pages — 12 gần đây nhất, 2 cột */}
            {recentPages.length > 0 && (
              <section className="mb-8">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted/60 mb-3 flex items-center gap-1.5">
                  <I.Clock size={12} />
                  Gần đây
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  {recentPages.map((p) => {
                    const IconC =
                      (
                        I as Record<
                          string,
                          React.ComponentType<{ size?: number; className?: string }>
                        >
                      )[p.icon] ?? I.Layout;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onSelectPage(p.id)}
                        className="group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border/40 bg-panel hover:bg-accent/5 hover:border-accent/20 transition-all text-left"
                      >
                        <IconC
                          size={14}
                          className="shrink-0 text-muted group-hover:text-accent transition-colors"
                        />
                        <span className="text-sm text-text truncate group-hover:text-accent transition-colors">
                          {p.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Gợi ý xem tất cả — ở ngay dưới Gần đây */}
            {onOpenAllPages && (
              <div className="mb-8">
                <button
                  type="button"
                  onClick={onOpenAllPages}
                  className="flex items-center gap-1.5 text-xs text-accent/60 hover:text-accent transition-colors"
                >
                  <I.LayoutGrid size={11} className="shrink-0" />
                  Xem tất cả danh sách
                </button>
              </div>
            )}

            {/* All pages — two-column browser */}
            {navRoots.length > 0 && (
              <MenuBrowser
                roots={navRoots}
                childrenOf={navChildrenOf}
                activePageId={null}
                onSelectPage={onSelectPage}
                focusCategory={focusCategory}
                onFocusCategoryUsed={onFocusCategoryUsed}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ─── MenuBrowser: two-column Explorer-like ───────────────── */
function findInChildren(
  target: string,
  parent: string,
  map: Map<string, NavNode[]>,
): string[] | null {
  const kids = map.get(parent) ?? [];
  for (const k of kids) {
    if (k.code === target) return [target];
    const sub = findInChildren(target, k.code, map);
    if (sub) return [k.code, ...sub];
  }
  return null;
}

function MenuBrowser({
  roots,
  childrenOf,
  onSelectPage,
  focusCategory,
  onFocusCategoryUsed,
}: {
  roots: NavNode[];
  childrenOf: Map<string, NavNode[]>;
  activePageId: string | null;
  onSelectPage: (id: string) => void;
  focusCategory?: string | null;
  onFocusCategoryUsed?: () => void;
}) {
  const [selectedRoot, setSelectedRoot] = useState<string | null>(null);
  const [drillPath, setDrillPath] = useState<string[]>([]);

  // Khi focusCategory thay đổi, chọn root và mở drill path
  useEffect(() => {
    if (!focusCategory) return;
    // Tìm root chứa category này
    const findPath = (code: string): string[] | null => {
      for (const root of roots) {
        if (root.code === code) return [code];
        const sub = findInChildren(code, root.code, childrenOf);
        if (sub) return sub;
      }
      return null;
    };
    const path = findPath(focusCategory);
    if (path) {
      setSelectedRoot(path[0]);
      setDrillPath(path.slice(1));
    }
    onFocusCategoryUsed?.();
  }, [focusCategory, roots, childrenOf, onFocusCategoryUsed]);

  const visibleRoots = useMemo(
    () => roots.filter((r) => (childrenOf.get(r.code)?.length ?? 0) > 0),
    [roots, childrenOf],
  );

  // Items hiện tại trong panel phải (theo drillPath)
  const currentItems = useMemo((): { code: string; node: NavNode }[] => {
    const target = drillPath.length > 0 ? drillPath[drillPath.length - 1] : selectedRoot;
    if (!target) return [];
    const kids = childrenOf.get(target) ?? [];
    return kids.map((n) => ({ code: n.code, node: n }));
  }, [selectedRoot, drillPath, childrenOf]);

  const selectRoot = useCallback((code: string) => {
    setSelectedRoot(code);
    setDrillPath([]);
  }, []);

  const drillIn = useCallback((code: string) => {
    setDrillPath((prev) => [...prev, code]);
  }, []);

  // Breadcrumb cho panel phải
  const breadcrumb = useMemo(() => {
    const parts: { code: string; label: string }[] = [];
    if (!selectedRoot) return parts;
    const rootNode = roots.find((r) => r.code === selectedRoot);
    if (rootNode) parts.push({ code: selectedRoot, label: labelOf(rootNode) });
    let curCode = selectedRoot;
    for (const step of drillPath) {
      const kids = childrenOf.get(curCode);
      const node = kids?.find((n) => n.code === step);
      if (node) {
        parts.push({ code: step, label: labelOf(node) });
        curCode = step;
      }
    }
    return parts;
  }, [selectedRoot, drillPath, roots, childrenOf]);

  if (visibleRoots.length === 0) return null;

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted/60 mb-3 flex items-center gap-1.5">
        <I.Layout size={12} />
        Danh mục
      </h2>
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="flex">
          {/* Left panel — root list */}
          <div className="w-40 shrink-0 border-r border-border bg-panel-2/50 max-h-[50vh] overflow-y-auto">
            {visibleRoots.map((r) => {
              const active = r.code === selectedRoot;
              const kids = childrenOf.get(r.code) ?? [];
              return (
                <button
                  key={r.code}
                  type="button"
                  onClick={() => {
                    if (active) {
                      setSelectedRoot(null);
                      setDrillPath([]);
                    } else {
                      selectRoot(r.code);
                    }
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors",
                    active ? "bg-accent/10 text-accent font-medium" : "text-text hover:bg-hover/40",
                  )}
                >
                  <I.ChevronRight
                    size={10}
                    className={cn(
                      "shrink-0 text-muted/40 transition-transform",
                      active && "rotate-90",
                    )}
                  />
                  <span className="truncate lowercase first-letter:uppercase">{labelOf(r)}</span>
                  <span className="text-[10px] text-muted/30 ml-auto">{kids.length}</span>
                </button>
              );
            })}
          </div>

          {/* Right panel — items */}
          <div className="flex-1 min-w-0 max-h-[50vh] overflow-y-auto">
            {!selectedRoot ? (
              <div className="flex items-center justify-center h-24 text-xs text-muted/50">
                Chọn danh mục bên trái
              </div>
            ) : (
              <div className="py-1">
                {/* Breadcrumb */}
                {breadcrumb.length > 1 && (
                  <div className="flex items-center gap-1 px-3 pb-1.5 text-xs text-muted/60 border-b border-border mb-1">
                    {breadcrumb.map((crumb, ci) => (
                      <span key={crumb.code} className="flex items-center gap-1">
                        {ci > 0 && <I.ChevronRight size={9} className="text-muted/30" />}
                        {ci < breadcrumb.length - 1 ? (
                          <button
                            type="button"
                            onClick={() => {
                              // Pop back to this level
                              setDrillPath(drillPath.slice(0, ci - 1));
                            }}
                            className="hover:text-accent transition-colors"
                          >
                            {crumb.label}
                          </button>
                        ) : (
                          <span className="font-medium text-text">{crumb.label}</span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
                {currentItems.map(({ node }) => {
                  const hasKids = (childrenOf.get(node.code)?.length ?? 0) > 0;
                  const isFolder = hasKids && !node.pageId;
                  const isPage = !!node.pageId;
                  const IconC = I.Layout;
                  return (
                    <button
                      key={node.code}
                      type="button"
                      onClick={() => {
                        if (isPage) {
                          onSelectPage(node.pageId as string);
                        } else if (hasKids) {
                          drillIn(node.code);
                        }
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left",
                        isPage ? "text-text hover:bg-hover/40" : "text-text hover:bg-accent/5",
                      )}
                    >
                      {isFolder ? (
                        <I.FolderOpen size={13} className="shrink-0 text-warning/60" />
                      ) : (
                        <IconC size={13} className="shrink-0 text-muted" />
                      )}
                      <span className="truncate lowercase first-letter:uppercase">
                        {labelOf(node)}
                      </span>
                      {hasKids && (
                        <I.ChevronRight size={11} className="ml-auto shrink-0 text-muted/40" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
